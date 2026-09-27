use std::{
    collections::{BTreeMap, HashMap},
    env,
    str::FromStr,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{bail, Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use futures_util::StreamExt;
use gmsol_sdk::{
    builders::order::{CreateOrderKind, CreateOrderParams},
    client::ops::exchange::order::MIN_EXECUTION_LAMPORTS as ORDER_EXECUTION_FEE_LAMPORTS,
    client::transaction_history::{extract_cpi_events, fetch_transaction_history_with_config},
    core::{
        market::MarketFlag,
        order::{OrderKind, TradeFlag},
        pubkey::optional_address,
    },
    decode::{gmsol::programs::GMSOLCPIEvent, Decode},
    market::{MarketCalculations, MarketStatus},
    model::{
        price::{Price, Prices},
        MarketModel, PositionModel,
    },
    ops::ExchangeOps,
    position::{status::PositionStatus, PositionCalculations},
    programs::{
        anchor_lang::Discriminator,
        bytemuck,
        constants::MARKET_DECIMALS,
        gmsol_store::accounts::{Market, Position, VirtualInventory},
        model::VirtualInventoryModel,
    },
    simulation::{
        order::{OrderSimulationOutput, UpdatePriceOptions},
        SimulationOptions, Simulator, TokenState,
    },
    solana_utils::{
        cluster::Cluster,
        solana_sdk::{
            commitment_config::CommitmentConfig, pubkey::Pubkey, signer::null_signer::NullSigner,
        },
        transaction_builder::{default_before_sign, TransactionBuilder},
    },
    Client,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

const SDK_VERSION: &str = "0.10.0";
const SDK_REVISION: &str = "7ce035b41a266cb5ddb0192e5d29deb0c7e67a72";
const PROGRAM_ID: &str = "Gmso1uvJnLbawvw7yezdfCDcPydwW2s2iqG3w6MDucLo";
const PROGRAMDATA_ADDRESS: &str = "CSp2sB68THdrJP6N7Au4Y5u89VJ1E1ebaqZ2soHhQvav";
const PROGRAMDATA_SHA256: &str = "c8614c3a9b44169252b19936fea13a07fc53731160d5983aec8abe90b51b4dcf";
const PROGRAMDATA_SLOT: u64 = 438_769_784;
const DEPLOYMENT_CACHE_MS: u64 = 60_000;
const USDC_MINT: &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const MAX_LEVERAGE_BPS: u64 = 100_000;

#[derive(Debug, Deserialize)]
struct Request {
    id: String,
    command: String,
    #[serde(default)]
    payload: Value,
}

#[derive(Debug, Serialize)]
struct Response {
    id: String,
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<ErrorBody>,
}

#[derive(Debug, Serialize)]
struct ErrorBody {
    code: &'static str,
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarketOutput {
    venue: String,
    native_symbol: String,
    native_market_name: String,
    market_address: String,
    market_token_address: String,
    base_decimals: u8,
    price_decimals: u8,
    maximum_leverage_bps: u64,
    active: bool,
    mark_price_micro_usd: Option<String>,
    bid_price_micro_usd: Option<String>,
    ask_price_micro_usd: Option<String>,
    funding_rate_bps_hourly: Option<String>,
    opening_fee_bps: Option<u64>,
    source_slot: Option<String>,
    fetched_at: u64,
    unavailable_reason: Option<String>,
}

struct GmQuoteSimulation {
    execution_price: u128,
    size_in_tokens: u128,
    price_impact_value: i128,
    opening_fee_value: u128,
}

#[derive(Clone)]
struct DeploymentCheck {
    checked_at: u64,
    verified: bool,
    error: Option<String>,
    programdata_hash: Option<String>,
    programdata_slot: Option<u64>,
}

struct Adapter {
    client: Client<Arc<NullSigner>>,
    http: reqwest::Client,
    cluster: Cluster,
    history_cache: Mutex<HashMap<Pubkey, (u64, Vec<Value>)>>,
    deployment_cache: Mutex<Option<DeploymentCheck>>,
}

impl Adapter {
    fn new() -> Result<Self> {
        let authority = Pubkey::new_unique();
        let signer = Arc::new(NullSigner::new(&authority));
        let cluster = env::var("SOLANA_RPC_URL")
            .ok()
            .filter(|url| !url.trim().is_empty())
            .map(|url| Cluster::from_str(&url))
            .transpose()?
            .unwrap_or(Cluster::Mainnet);
        Ok(Self {
            client: Client::new(cluster.clone(), signer)?,
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(8))
                .build()?,
            cluster,
            history_cache: Mutex::new(HashMap::new()),
            deployment_cache: Mutex::new(None),
        })
    }

    fn client_for(&self, wallet: &Pubkey) -> Result<Client<Arc<NullSigner>>> {
        Client::new(self.cluster.clone(), Arc::new(NullSigner::new(wallet))).map_err(Into::into)
    }

    async fn dispatch(&self, request: &Request) -> Result<Value> {
        match request.command.as_str() {
            "health" => self.health().await,
            "markets" => Ok(serde_json::to_value(self.markets().await?)?),
            "quote" => self.quote(&request.payload).await,
            "portfolio" => self.portfolio(&request.payload).await,
            "prepare_action" => self.prepare_action(&request.payload).await,
            _ => bail!("unsupported command"),
        }
    }

    async fn deployment_check(&self) -> Result<DeploymentCheck> {
        if let Some(cached) = self
            .deployment_cache
            .lock()
            .map_err(|_| anyhow::anyhow!("GMTrade deployment cache lock poisoned"))?
            .clone()
        {
            if now_ms().saturating_sub(cached.checked_at) < DEPLOYMENT_CACHE_MS {
                return Ok(cached);
            }
        }
        let expected_program = Pubkey::from_str(PROGRAM_ID)?;
        let expected_programdata = Pubkey::from_str(PROGRAMDATA_ADDRESS)?;
        let loader = gmsol_sdk::solana_utils::solana_sdk::bpf_loader_upgradeable::id();
        let check = match self.client.rpc().get_account(&expected_program).await {
            Ok(program)
                if program.executable && program.owner == loader && program.data.len() == 36 =>
            {
                let linked_programdata = Pubkey::try_from(&program.data[4..36])?;
                if linked_programdata != expected_programdata {
                    DeploymentCheck {
                        checked_at: now_ms(),
                        verified: false,
                        error: Some("GMTrade programdata address changed".to_string()),
                        programdata_hash: None,
                        programdata_slot: None,
                    }
                } else {
                    match self.client.rpc().get_account(&expected_programdata).await {
                        Ok(programdata)
                            if programdata.owner == loader && programdata.data.len() >= 12 =>
                        {
                            let slot = u64::from_le_bytes(programdata.data[4..12].try_into()?);
                            let hash = format!("{:x}", Sha256::digest(&programdata.data));
                            let verified = hash == PROGRAMDATA_SHA256 && slot == PROGRAMDATA_SLOT;
                            DeploymentCheck {
                                checked_at: now_ms(),
                                verified,
                                error: (!verified).then(|| {
                                    "GMTrade reviewed deployment hash or slot changed".to_string()
                                }),
                                programdata_hash: Some(hash),
                                programdata_slot: Some(slot),
                            }
                        }
                        Ok(_) => DeploymentCheck {
                            checked_at: now_ms(),
                            verified: false,
                            error: Some("GMTrade programdata account is malformed".to_string()),
                            programdata_hash: None,
                            programdata_slot: None,
                        },
                        Err(error) => DeploymentCheck {
                            checked_at: now_ms(),
                            verified: false,
                            error: Some(error.to_string()),
                            programdata_hash: None,
                            programdata_slot: None,
                        },
                    }
                }
            }
            Ok(_) => DeploymentCheck {
                checked_at: now_ms(),
                verified: false,
                error: Some("GMTrade program account is not the reviewed executable".to_string()),
                programdata_hash: None,
                programdata_slot: None,
            },
            Err(error) => DeploymentCheck {
                checked_at: now_ms(),
                verified: false,
                error: Some(error.to_string()),
                programdata_hash: None,
                programdata_slot: None,
            },
        };
        *self
            .deployment_cache
            .lock()
            .map_err(|_| anyhow::anyhow!("GMTrade deployment cache lock poisoned"))? =
            Some(check.clone());
        Ok(check)
    }

    async fn health(&self) -> Result<Value> {
        let check = self.deployment_check().await?;
        Ok(json!({
            "sdkVersion": SDK_VERSION,
            "sdkRevision": SDK_REVISION,
            "programId": PROGRAM_ID,
            "programdataAddress": PROGRAMDATA_ADDRESS,
            "programdataHash": check.programdata_hash,
            "programdataSlot": check.programdata_slot,
            "deploymentVerified": check.verified,
            "deploymentError": check.error,
            "checkedAt": check.checked_at,
        }))
    }

    async fn market_accounts(&self) -> Result<Vec<(Pubkey, Arc<Market>, String)>> {
        let store = self.client.find_store_address("");
        let fetched = self
            .client
            .markets(&store)
            .await
            .context("fetch GMTrade markets")?;
        let mut output = Vec::new();
        for (address, market) in fetched {
            let name = market.name().unwrap_or_default().to_string();
            let upper = name.to_uppercase();
            let symbol = ["SOL", "BTC", "ETH"].into_iter().find(|symbol| {
                upper.starts_with(symbol) || upper.contains(&format!("{symbol}/USD"))
            });
            if let Some(symbol) = symbol {
                output.push((address, market, symbol.to_string()));
            }
        }
        Ok(output)
    }

    async fn markets(&self) -> Result<Vec<MarketOutput>> {
        let mut output = Vec::new();
        for (address, market, symbol) in self.market_accounts().await? {
            if market.meta.short_token_mint.to_string() != USDC_MINT
                || market.meta.long_token_mint.to_string() != USDC_MINT
            {
                continue;
            }
            let active = market.flags.get_flag(MarketFlag::Enabled)
                && !market.flags.get_flag(MarketFlag::Closed);
            let price = self
                .oracle_price(&market.meta.index_token_mint.to_string())
                .await
                .ok();
            output.push(MarketOutput {
                venue: "gmtrade".to_string(),
                native_symbol: symbol.clone(),
                native_market_name: market.name().unwrap_or_default().to_string(),
                market_address: address.to_string(),
                market_token_address: market.meta.market_token_mint.to_string(),
                base_decimals: base_decimals(&symbol),
                price_decimals: 6,
                maximum_leverage_bps: MAX_LEVERAGE_BPS,
                active,
                mark_price_micro_usd: price.as_ref().map(|p| p.0.clone()),
                bid_price_micro_usd: None,
                ask_price_micro_usd: None,
                funding_rate_bps_hourly: None,
                opening_fee_bps: Some(factor_to_bps(
                    market
                        .config
                        .order_fee_factor_for_negative_impact
                        .max(market.config.order_fee_factor_for_positive_impact),
                )),
                source_slot: None,
                fetched_at: now_ms(),
                unavailable_reason: if active {
                    None
                } else {
                    Some("GMTrade market is disabled or closed.".to_string())
                },
            });
        }
        output.sort_by_key(|market| match market.native_symbol.as_str() {
            "SOL" => 0,
            "BTC" => 1,
            "ETH" => 2,
            _ => 3,
        });
        Ok(output)
    }

    async fn oracle_price(&self, index_token: &str) -> Result<(String, String, String)> {
        let now = now_ms() / 1000;
        let query = "query Candles($indexToken: String!, $resolution: Int!, $from: Int!, $to: Int!) { candles(indexToken: $indexToken, resolution: $resolution, from: $from, to: $to) { timestamp open high low close } }";
        let response: Value = self.http.post("https://price-candle-mainnet.gmtrade.xyz/graphql")
            .json(&json!({"query":query,"variables":{"indexToken":index_token,"resolution":60,"from":now.saturating_sub(600),"to":now}}))
            .send().await?.error_for_status()?.json().await?;
        let rows = response
            .pointer("/data/candles")
            .and_then(Value::as_array)
            .context("GMTrade candle response missing data")?;
        let last = rows
            .last()
            .context("GMTrade returned no current oracle candle")?;
        let convert = |key: &str| -> Result<String> {
            let raw = last
                .get(key)
                .and_then(Value::as_str)
                .context("GMTrade candle price missing")?
                .parse::<u128>()?;
            Ok((raw / 1_000_000_000_000u128).to_string())
        };
        let close = convert("close")?;
        Ok((close, convert("low")?, convert("high")?))
    }

    async fn quote(&self, payload: &Value) -> Result<Value> {
        let intent = payload.get("intent").context("intent missing")?;
        let market: MarketOutput =
            serde_json::from_value(payload.get("market").cloned().context("market missing")?)?;
        let collateral = string_u128(intent, "collateralAtomic")?;
        let leverage = intent
            .get("leverageBps")
            .and_then(Value::as_u64)
            .context("leverage missing")? as u128;
        if !(10_000..=MAX_LEVERAGE_BPS as u128).contains(&leverage) {
            bail!("leverage is outside the Flay 1x to 10x launch range");
        }
        let notional = collateral
            .checked_mul(leverage)
            .context("notional overflow")?
            / 10_000;
        let side = string(intent, "side")?;
        let order_type = string(intent, "orderType")?;
        let mark = market
            .mark_price_micro_usd
            .as_ref()
            .context("GMTrade oracle price unavailable")?
            .parse::<u128>()?;
        let entry = if order_type == "limit" {
            string_u128(intent, "limitPriceMicroUsd")?
        } else {
            mark
        };
        let slippage = intent
            .get("slippageBps")
            .and_then(Value::as_u64)
            .unwrap_or(50) as u128;
        let acceptable = if side == "long" {
            entry * (10_000 + slippage) / 10_000
        } else {
            entry * (10_000 - slippage) / 10_000
        };
        let market_address = Pubkey::from_str(&market.market_address)?;
        let live_market = self
            .client
            .market(&market_address)
            .await
            .context("fetch GMTrade market rates")?;
        let status = authoritative_market_status(live_market.clone(), mark, market.base_decimals)?;
        let (funding_rate, borrowing_rate) = if side == "long" {
            (
                status.funding_rate_per_second_for_long,
                status.borrowing_rate_per_second_for_long,
            )
        } else {
            (
                status.funding_rate_per_second_for_short,
                status.borrowing_rate_per_second_for_short,
            )
        };
        let simulation = self
            .simulate_increase_quote(
                live_market,
                mark,
                collateral,
                notional,
                side == "long",
                order_type == "limit",
                entry,
                acceptable,
                market.base_decimals,
            )
            .await?;
        let execution_price =
            protocol_price_to_micro(simulation.execution_price, market.base_decimals);
        let opening_fee = simulation.opening_fee_value / pow10(MARKET_DECIMALS - 6);
        let impact_micro =
            simulation.price_impact_value.unsigned_abs() / pow10(MARKET_DECIMALS - 6);
        let impact_bps = simulation
            .price_impact_value
            .unsigned_abs()
            .saturating_mul(10_000)
            / micro_usd_to_protocol(notional)?.max(1);
        let immediate_cost =
            opening_fee.saturating_add(if simulation.price_impact_value.is_negative() {
                impact_micro
            } else {
                0
            });
        let fetched_at = now_ms();
        Ok(json!({
            "id": uuid_like(), "venue":"gmtrade", "market":intent["market"], "nativeMarketAddress":market.market_address,
            "nativeMarketTokenAddress":market.market_token_address,
            "side":side, "orderType":order_type, "collateralAtomic":collateral.to_string(), "notionalMicroUsd":notional.to_string(),
            "baseSizeAtomic":simulation.size_in_tokens.to_string(), "baseDecimals":market.base_decimals, "entryPriceMicroUsd":execution_price.to_string(),
            "acceptablePriceMicroUsd":acceptable.to_string(),
            "liquidationPriceMicroUsd":liquidation_estimate_micro(entry, side == "long", leverage).to_string(),
            "openingFeeMicroUsd":opening_fee.to_string(), "executionFeeLamports":ORDER_EXECUTION_FEE_LAMPORTS.to_string(), "networkFeeLamports":Value::Null,
            "accountRentLamports":Value::Null, "immediateCostMicroUsd":immediate_cost.to_string(),
            "priceImpactBps":u64::try_from(impact_bps).unwrap_or(u64::MAX),
            "fundingRateBpsHourly":factor_per_second_to_hourly_bps(funding_rate)?,
            "borrowingRateBpsHourly":factor_per_second_to_hourly_bps(i128::try_from(borrowing_rate).context("borrowing rate exceeds i128")?)?, "setupSteps":[],
            "executionEligible":market.active, "exclusionCode":if market.active { Value::Null } else { json!("MARKET_PAUSED") },
            "exclusionReason":if market.active { Value::Null } else { json!("GMTrade market is paused.") }, "sourceSlot":Value::Null,
            "fetchedAt":fetched_at, "expiresAt":fetched_at+10_000,
        }))
    }

    #[allow(clippy::too_many_arguments)]
    async fn simulate_increase_quote(
        &self,
        market: Arc<Market>,
        mark_micro: u128,
        collateral_atomic: u128,
        notional_micro: u128,
        is_long: bool,
        is_limit: bool,
        trigger_micro: u128,
        acceptable_micro: u128,
        token_decimals: u8,
    ) -> Result<GmQuoteSimulation> {
        let market_token = market.meta.market_token_mint;
        let index_price = micro_price_to_protocol(mark_micro, token_decimals)?;
        let stable_price = micro_price_to_protocol(1_000_000, 6)?;
        let mut tokens = HashMap::new();
        tokens.insert(
            market.meta.index_token_mint,
            TokenState::from_price(Some(Arc::new(Price {
                min: index_price,
                max: index_price,
            }))),
        );
        let stable = TokenState::from_price(Some(Arc::new(Price {
            min: stable_price,
            max: stable_price,
        })));
        tokens.insert(market.meta.long_token_mint, stable.clone());
        tokens.insert(market.meta.short_token_mint, stable);

        let mut markets = HashMap::new();
        markets.insert(market_token, MarketModel::from_parts(market.clone(), 0));
        let mut virtual_inventories = BTreeMap::new();
        let vi_address = market.virtual_inventory_for_positions;
        if vi_address != Pubkey::default() {
            let raw = self
                .client
                .rpc()
                .get_account(&vi_address)
                .await
                .context("fetch GMTrade position virtual inventory")?;
            if raw.owner != Pubkey::from_str(PROGRAM_ID)? {
                bail!("GMTrade position virtual inventory has an unexpected owner");
            }
            if !raw.data.starts_with(VirtualInventory::DISCRIMINATOR) {
                bail!("GMTrade position virtual inventory discriminator changed");
            }
            let end =
                VirtualInventory::DISCRIMINATOR.len() + std::mem::size_of::<VirtualInventory>();
            let body = raw
                .data
                .get(VirtualInventory::DISCRIMINATOR.len()..end)
                .context("GMTrade position virtual inventory is truncated")?;
            // The generated SDK decoder borrows bytes after Anchor's 8-byte
            // discriminator. On ARM that slice is not necessarily aligned for
            // the zero-copy account, so read the reviewed POD value unaligned.
            let account = bytemuck::pod_read_unaligned::<VirtualInventory>(body);
            virtual_inventories.insert(
                vi_address,
                VirtualInventoryModel::from_parts(Arc::new(account)),
            );
        }
        let mut simulator =
            Simulator::from_parts(tokens, markets, HashMap::new(), virtual_inventories);
        let mut params = CreateOrderParams::builder()
            .market_token(market_token)
            .is_long(is_long)
            .size(micro_usd_to_protocol(notional_micro)?)
            .amount(collateral_atomic)
            .acceptable_price(micro_price_to_protocol(acceptable_micro, token_decimals)?)
            .build();
        if is_limit {
            params.trigger_price = Some(micro_price_to_protocol(trigger_micro, token_decimals)?);
        }
        let kind = if is_limit {
            CreateOrderKind::LimitIncrease
        } else {
            CreateOrderKind::MarketIncrease
        };
        let collateral_token = Pubkey::from_str(USDC_MINT)?;
        let mut simulation = simulator
            .simulate_order(kind, &params, &collateral_token)
            .build();
        if is_limit {
            simulation = simulation.update_prices(UpdatePriceOptions::default())?;
        }
        let output = simulation.execute_with_options(SimulationOptions {
            skip_limit_price_validation: false,
            disable_vis: false,
        })?;
        let OrderSimulationOutput::Increase { report, .. } = output else {
            bail!("GMTrade increase simulation returned an unexpected result");
        };
        Ok(GmQuoteSimulation {
            execution_price: *report.execution().execution_price(),
            size_in_tokens: *report.execution().size_delta_in_tokens(),
            price_impact_value: *report.execution().price_impact_value(),
            opening_fee_value: *report.fees().order_fees().fee_value(),
        })
    }

    async fn trade_history(
        &self,
        client: &Client<Arc<NullSigner>>,
        owner: &Pubkey,
        market_symbols: &HashMap<Pubkey, String>,
    ) -> Result<Vec<Value>> {
        if let Some((fetched_at, rows)) = self
            .history_cache
            .lock()
            .map_err(|_| anyhow::anyhow!("GMTrade history cache lock poisoned"))?
            .get(owner)
            .cloned()
        {
            if now_ms().saturating_sub(fetched_at) < 30_000 {
                return Ok(rows);
            }
        }
        let commitment = CommitmentConfig::confirmed();
        let rpc = Arc::new(self.cluster.rpc(commitment));
        let signatures = fetch_transaction_history_with_config(
            rpc.clone(),
            owner,
            commitment,
            None,
            None,
            Some(5),
        )
        .await?
        .take(5);
        let event_authority = client.store_event_authority();
        let events = extract_cpi_events(
            signatures,
            rpc,
            client.store_program_id(),
            &event_authority,
            commitment,
            Some(0),
        )
        .take(5);
        futures_util::pin_mut!(events);
        let mut rows = Vec::new();
        while let Some(batch) = events.next().await {
            let encoded = batch?.into_value();
            for event in &encoded.events {
                match GMSOLCPIEvent::decode(event)? {
                    GMSOLCPIEvent::TradeEvent(event) if event.user == *owner => {
                        let Some(symbol) = market_symbols.get(&event.market_token) else {
                            continue;
                        };
                        let size_delta = event
                            .after
                            .size_in_tokens
                            .abs_diff(event.before.size_in_tokens);
                        let kind = if event.get_flag(TradeFlag::IsIncrease) {
                            "open"
                        } else if event.after.size_in_tokens == 0 {
                            "close"
                        } else {
                            "reduce"
                        };
                        rows.push(json!({
                            "venue":"gmtrade", "nativeId":format!("{}:{}", event.order, event.trade_id),
                            "market":format!("{symbol}-PERP"), "kind":kind, "status":"filled",
                            "sizeAtomic":size_delta.to_string(),
                            "priceMicroUsd":protocol_price_to_micro(event.execution_price, base_decimals(symbol)).to_string(),
                            "signature":Value::Null,
                            "occurredAt":u64::try_from(event.ts).unwrap_or_default().saturating_mul(1_000),
                        }));
                    }
                    GMSOLCPIEvent::OrderRemoved(event) if event.owner == *owner => {
                        let Some(symbol) = market_symbols.get(&event.market_token) else {
                            continue;
                        };
                        rows.push(json!({
                            "venue":"gmtrade", "nativeId":event.order.to_string(),
                            "market":format!("{symbol}-PERP"), "kind":"order-removed", "status":event.reason,
                            "sizeAtomic":Value::Null, "priceMicroUsd":Value::Null, "signature":Value::Null,
                            "occurredAt":u64::try_from(event.ts).unwrap_or_default().saturating_mul(1_000),
                        }));
                    }
                    _ => {}
                }
            }
        }
        rows.sort_by_key(|row| std::cmp::Reverse(row["occurredAt"].as_u64().unwrap_or_default()));
        rows.truncate(50);
        let mut cache = self
            .history_cache
            .lock()
            .map_err(|_| anyhow::anyhow!("GMTrade history cache lock poisoned"))?;
        cache.insert(*owner, (now_ms(), rows.clone()));
        while cache.len() > 500 {
            if let Some(key) = cache.keys().next().copied() {
                cache.remove(&key);
            }
        }
        Ok(rows)
    }

    async fn portfolio(&self, payload: &Value) -> Result<Value> {
        let wallet = string(payload, "wallet")?;
        let owner = Pubkey::from_str(wallet)?;
        let client = self.client_for(&owner)?;
        let store = client.find_store_address("");
        let market_accounts = self.market_accounts().await?;
        let market_by_token: HashMap<Pubkey, (Arc<Market>, String)> = market_accounts
            .iter()
            .map(|(_, market, symbol)| {
                (
                    market.meta.market_token_mint,
                    (market.clone(), symbol.clone()),
                )
            })
            .collect();
        let market_symbols: HashMap<Pubkey, String> = market_accounts
            .iter()
            .map(|(_, market, symbol)| (market.meta.market_token_mint, symbol.clone()))
            .collect();
        let positions = client
            .positions(&store, Some(&owner), None)
            .await
            .context("fetch GMTrade positions")?;
        let orders = client
            .orders(&store, Some(&owner), None)
            .await
            .context("fetch GMTrade orders")?;
        let mut position_rows = Vec::new();
        let mut position_index = HashMap::<Pubkey, usize>::new();

        for (address, position) in &positions {
            if position.collateral_token.to_string() != USDC_MINT {
                continue;
            }
            let Some((market, symbol)) = market_by_token.get(&position.market_token) else {
                continue;
            };
            let size_atomic = position.state.size_in_tokens;
            if size_atomic == 0 {
                continue;
            }
            let entry_micro = price_micro_from_position(position, base_decimals(symbol));
            let decimals = base_decimals(symbol);
            let live = self
                .oracle_price(&market.meta.index_token_mint.to_string())
                .await
                .ok();
            let mark_micro = live
                .as_ref()
                .and_then(|price| price.0.parse::<u128>().ok())
                .unwrap_or(entry_micro);
            let size_units_scale = 10u128.pow(decimals as u32);
            let fallback_pnl = if position.try_is_long()? {
                signed_mul_div(
                    mark_micro as i128 - entry_micro as i128,
                    size_atomic,
                    size_units_scale,
                )
            } else {
                signed_mul_div(
                    entry_micro as i128 - mark_micro as i128,
                    size_atomic,
                    size_units_scale,
                )
            };
            let status = live.as_ref().and_then(|prices| {
                authoritative_position_status(market.clone(), Arc::new(*position), prices, decimals)
                    .ok()
            });
            let pnl = status
                .as_ref()
                .map(|value| protocol_signed_usd_to_micro(value.pending_pnl))
                .unwrap_or(fallback_pnl);
            let liquidation_price = status
                .as_ref()
                .and_then(|value| value.liquidation_price)
                .map(|value| protocol_price_to_micro(value, decimals));
            let collateral = position.state.collateral_amount;
            let leverage_bps = status
                .as_ref()
                .and_then(|value| value.leverage)
                .map(factor_to_bps)
                .or_else(|| {
                    (position.state.size_in_usd / pow10(MARKET_DECIMALS - 6))
                        .checked_mul(10_000)
                        .and_then(|notional| notional.checked_div(collateral))
                        .map(|value| value.min(MAX_LEVERAGE_BPS as u128) as u64)
                });
            let index = position_rows.len();
            position_index.insert(*address, index);
            position_rows.push(json!({
                "venue":"gmtrade", "nativeId":address.to_string(), "market":format!("{symbol}-PERP"),
                "side":if position.try_is_long()? {"long"} else {"short"}, "sizeAtomic":size_atomic.to_string(),
                "baseDecimals":decimals, "collateralAtomic":collateral.to_string(),
                "entryPriceMicroUsd":entry_micro.to_string(), "markPriceMicroUsd":mark_micro.to_string(),
                "liquidationPriceMicroUsd":liquidation_price.map(|value| value.to_string()), "unrealizedPnlMicroUsd":pnl.to_string(),
                "leverageBps":leverage_bps, "conditionals":[], "updatedAt":now_ms(),
            }));
        }

        let mut order_rows = Vec::new();
        let mut orphaned_rows = Vec::new();
        let mut resting_order_collateral = 0u128;
        for (address, order) in &orders {
            let Some((market, symbol)) = market_by_token.get(&order.market_token) else {
                continue;
            };
            let kind = order.params.kind()?;
            let side_long = order.params.side()?.is_long();
            let trigger_micro =
                protocol_price_to_micro(order.params.trigger_price, base_decimals(symbol));
            let reference = if trigger_micro > 0 {
                trigger_micro
            } else {
                self.oracle_price(&market.meta.index_token_mint.to_string())
                    .await
                    .ok()
                    .and_then(|price| price.0.parse().ok())
                    .unwrap_or(0)
            };
            let size_usd_micro = order.params.size_delta_value / pow10(MARKET_DECIMALS - 6);
            let size_atomic = size_usd_micro
                .checked_mul(pow10(base_decimals(symbol)))
                .and_then(|value| value.checked_div(reference))
                .unwrap_or(0);
            let reduce_only = kind.is_decrease_position();
            let conditional_kind = match kind {
                OrderKind::StopLossDecrease => Some("stop-loss"),
                OrderKind::LimitDecrease => Some("take-profit"),
                _ => None,
            };
            if let Some(conditional_kind) = conditional_kind {
                let mut condition = json!({
                    "venue":"gmtrade", "nativeId":address.to_string(), "kind":conditional_kind,
                    "triggerPriceMicroUsd":trigger_micro.to_string(),
                    "executionPriceMicroUsd":protocol_price_to_micro(
                        if order.params.acceptable_price > 0 { order.params.acceptable_price } else { order.params.trigger_price },
                        base_decimals(symbol),
                    ).to_string(), "sizeAtomic":size_atomic.to_string(),
                    "orphaned":false, "status":"active"
                });
                if let Some(position_address) = optional_address(&order.params.position) {
                    if let Some(index) = position_index.get(position_address).copied() {
                        position_rows[index]["conditionals"]
                            .as_array_mut()
                            .context("conditionals shape")?
                            .push(condition);
                        continue;
                    }
                }
                condition["orphaned"] = json!(true);
                condition["market"] = json!(format!("{symbol}-PERP"));
                orphaned_rows.push(condition);
                continue;
            }
            if kind.is_increase_position()
                && matches!(kind, OrderKind::MarketIncrease | OrderKind::LimitIncrease)
            {
                if order.params.collateral_token.to_string() == USDC_MINT {
                    resting_order_collateral = resting_order_collateral
                        .saturating_add(u128::from(order.params.initial_collateral_delta_amount));
                }
                let is_limit = matches!(kind, OrderKind::LimitIncrease);
                order_rows.push(json!({
                    "venue":"gmtrade", "nativeId":address.to_string(), "market":format!("{symbol}-PERP"),
                    "side":if side_long {"long"} else {"short"}, "orderType":if is_limit {"limit"} else {"market"}, "sizeAtomic":size_atomic.to_string(),
                    "remainingSizeAtomic":size_atomic.to_string(), "baseDecimals":base_decimals(symbol),
                    "limitPriceMicroUsd":if is_limit { json!(trigger_micro.to_string()) } else { Value::Null }, "reduceOnly":reduce_only,
                    "status":"active", "createdAt":Value::Null, "updatedAt":now_ms()
                }));
            }
        }

        let collateral = position_rows
            .iter()
            .filter_map(|row| row.get("collateralAtomic")?.as_str()?.parse::<u128>().ok())
            .sum::<u128>()
            .saturating_add(resting_order_collateral);
        let (history, history_error) =
            match self.trade_history(&client, &owner, &market_symbols).await {
                Ok(rows) => (rows, None),
                Err(error) => (
                    Vec::new(),
                    Some(format!("GMTrade history is unavailable: {error:#}")),
                ),
            };
        Ok(json!({
            "venue":"gmtrade", "available":true, "collateralAtomic":collateral.to_string(), "withdrawableAtomic":"0",
            "positions":position_rows, "orders":order_rows, "orphanedConditionals":orphaned_rows, "history":history, "error":history_error, "fetchedAt":now_ms()
        }))
    }

    async fn prepare_action(&self, payload: &Value) -> Result<Value> {
        let request = payload.get("request").context("request missing")?;
        let wallet = Pubkey::from_str(string(request, "wallet")?)?;
        let action = string(request, "action")?;
        let client = self.client_for(&wallet)?;
        let store = client.find_store_address("");
        let usdc = Pubkey::from_str(USDC_MINT)?;

        match action {
            "open" => {
                let quote = payload.get("quote").context("quote missing")?;
                let market_token = Pubkey::from_str(string(quote, "nativeMarketTokenAddress")?)?;
                let market_address = client.find_market_address(&store, &market_token);
                let market = client.market(&market_address).await.context("fetch selected GMTrade market")?;
                let is_collateral_long = if market.meta.long_token_mint == usdc { true } else if market.meta.short_token_mint == usdc { false } else { bail!("selected GMTrade market does not support direct USDC collateral") };
                let collateral: u64 = string_u128(quote, "collateralAtomic")?.try_into().context("collateral exceeds u64")?;
                let size_usd = micro_usd_to_protocol(string_u128(quote, "notionalMicroUsd")?)?;
                let acceptable = micro_price_to_protocol(string_u128(quote, "acceptablePriceMicroUsd")?, base_decimals(string(quote, "market")?.trim_end_matches("-PERP")))?;
                let is_long = string(quote, "side")? == "long";
                let order_type = string(quote, "orderType")?;
                let mut builder = if order_type == "market" {
                    client.market_increase(&store, &market_token, is_collateral_long, collateral, is_long, size_usd)
                } else {
                    client.limit_increase(&store, &market_token, is_long, size_usd, acceptable, is_collateral_long, collateral)
                };
                builder.initial_collateral_token(&usdc, None).acceptable_price(acceptable).execution_fee(ORDER_EXECUTION_FEE_LAMPORTS);
                let (transaction, _order) = builder.build_with_address().await.context("build GMTrade increase order")?;
                self.serialize_builder(transaction, Some(market_address)).await
            }
            "cancel" | "cancel-conditional" => {
                let order = Pubkey::from_str(string(request, "nativeId")?)?;
                let order_account = client.order(&order).await.context("GMTrade order no longer exists")?;
                if order_account.header.owner != wallet { bail!("GMTrade order belongs to another wallet"); }
                let market_token = order_account.market_token;
                let market_address = client.find_market_address(&store, &market_token);
                let transaction = client.close_order(&order)?.reason("cancelled in Flay").build().await?;
                self.serialize_builder(transaction, Some(market_address)).await
            }
            "close" | "reduce" | "take-profit" | "stop-loss" => {
                let position_address = Pubkey::from_str(string(request, "nativeId")?)?;
                let position = client.position(&position_address).await.context("GMTrade position no longer exists")?;
                if position.owner != wallet || position.collateral_token != usdc { bail!("GMTrade position is not a direct-USDC position for this wallet"); }
                let size_atomic = string_u128(request, "sizeAtomic")?;
                if size_atomic == 0 || size_atomic > position.state.size_in_tokens { bail!("requested size exceeds GMTrade position") }
                let size_usd = position.state.size_in_usd.checked_mul(size_atomic).context("size overflow")? / position.state.size_in_tokens;
                let collateral: u64 = (position.state.collateral_amount.checked_mul(size_atomic).context("collateral overflow")? / position.state.size_in_tokens).try_into().context("collateral exceeds u64")?;
                let market_token = position.market_token;
                let market_address = client.find_market_address(&store, &market_token);
                let market = client.market(&market_address).await?;
                let is_collateral_long = market.meta.long_token_mint == usdc;
                let is_long = position.try_is_long()?;
                let price_decimals = market_by_symbol_decimals(&market)?;
                let trigger = request.get("triggerPriceMicroUsd").and_then(Value::as_str).map(str::parse::<u128>).transpose()?.map(|price| micro_price_to_protocol(price, price_decimals)).transpose()?;
                let execution = request.get("executionPriceMicroUsd").and_then(Value::as_str).map(str::parse::<u128>).transpose()?.map(|price| micro_price_to_protocol(price, price_decimals)).transpose()?;
                let mut builder = match action {
                    "take-profit" => client.limit_decrease(&store, &market_token, is_long, size_usd, trigger.context("take-profit trigger missing")?, is_collateral_long, collateral),
                    "stop-loss" => client.stop_loss(&store, &market_token, is_long, size_usd, trigger.context("stop-loss trigger missing")?, is_collateral_long, collateral),
                    _ => client.market_decrease(&store, &market_token, is_collateral_long, collateral, is_long, size_usd),
                };
                if let Some(price) = execution {
                    builder.acceptable_price(price);
                } else if action == "close" || action == "reduce" {
                    let price = self.oracle_price(&market.meta.index_token_mint.to_string()).await?.0.parse::<u128>()?;
                    let adverse = if is_long { price * 9_950 / 10_000 } else { price * 10_050 / 10_000 };
                    builder.acceptable_price(micro_price_to_protocol(adverse, price_decimals)?);
                }
                builder.final_output_token(&usdc).execution_fee(ORDER_EXECUTION_FEE_LAMPORTS);
                let (transaction, _order) = builder.build_with_address().await.context("build GMTrade decrease order")?;
                self.serialize_builder(transaction, Some(market_address)).await
            }
            _ => bail!("GMTrade uses direct per-position USDC collateral; this action is not a GMTrade transaction"),
        }
    }

    async fn serialize_builder(
        &self,
        builder: TransactionBuilder<'_, Arc<NullSigner>>,
        market_token: Option<Pubkey>,
    ) -> Result<Value> {
        let programs = builder
            .instructions()
            .into_iter()
            .map(|instruction| instruction.program_id.to_string())
            .collect::<Vec<_>>();
        let transaction = builder
            .signed_transaction_with_options(false, None, None, default_before_sign)
            .await?;
        let lookup_tables = transaction
            .message
            .address_table_lookups()
            .unwrap_or_default()
            .iter()
            .map(|lookup| lookup.account_key.to_string())
            .collect::<Vec<_>>();
        let bytes = bincode::serialize(&transaction)?;
        if bytes.len() > 1232 {
            bail!("GMTrade transaction exceeds Solana packet size");
        }
        Ok(json!({
            "transaction":BASE64.encode(bytes), "programs":programs,
            "marketAddress":market_token.map(|address| address.to_string()),
            "lookupTables":lookup_tables,
            "warnings":["GMTrade uses direct USDC collateral for this isolated position."]
        }))
    }
}

fn string<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .with_context(|| format!("{key} missing"))
}

fn string_u128(value: &Value, key: &str) -> Result<u128> {
    string(value, key)?
        .parse::<u128>()
        .with_context(|| format!("{key} invalid"))
}

fn base_decimals(symbol: &str) -> u8 {
    match symbol {
        "SOL" => 9,
        "BTC" | "ETH" => 8,
        _ => 8,
    }
}

fn pow10(decimals: u8) -> u128 {
    10u128.pow(decimals as u32)
}

fn micro_usd_to_protocol(value: u128) -> Result<u128> {
    value
        .checked_mul(pow10(MARKET_DECIMALS - 6))
        .context("protocol USD value overflow")
}

fn micro_price_to_protocol(value: u128, token_decimals: u8) -> Result<u128> {
    let precision = MARKET_DECIMALS
        .checked_sub(token_decimals)
        .and_then(|value| value.checked_sub(6))
        .context("token precision exceeds GMTrade price precision")?;
    value
        .checked_mul(pow10(precision))
        .context("protocol price overflow")
}

fn protocol_price_to_micro(value: u128, token_decimals: u8) -> u128 {
    let precision = MARKET_DECIMALS
        .saturating_sub(token_decimals)
        .saturating_sub(6);
    value / pow10(precision)
}

fn market_by_symbol_decimals(market: &Market) -> Result<u8> {
    let name = market.name()?.to_uppercase();
    ["SOL", "BTC", "ETH"]
        .into_iter()
        .find(|symbol| name.starts_with(symbol))
        .map(base_decimals)
        .context("unsupported GMTrade launch market")
}

fn factor_to_bps(value: u128) -> u64 {
    let unit = pow10(MARKET_DECIMALS);
    value
        .saturating_mul(10_000)
        .div_ceil(unit)
        .min(u64::MAX as u128) as u64
}

fn price_micro_from_position(position: &Position, decimals: u8) -> u128 {
    if position.state.size_in_tokens == 0 {
        return 0;
    }
    position
        .state
        .size_in_usd
        .saturating_mul(pow10(decimals))
        .saturating_mul(1_000_000)
        / position.state.size_in_tokens
        / pow10(MARKET_DECIMALS)
}

fn liquidation_estimate_micro(price: u128, is_long: bool, leverage_bps: u128) -> u128 {
    let movement_bps = 10_000u128.saturating_mul(10_000) / leverage_bps.max(1);
    let delta = price.saturating_mul(movement_bps.saturating_sub(500)) / 10_000;
    if is_long {
        price.saturating_sub(delta)
    } else {
        price.saturating_add(delta)
    }
}

fn factor_per_second_to_hourly_bps(value: i128) -> Result<String> {
    const DISPLAY_DECIMALS: u32 = 6;
    let display_scale = 10u128.pow(DISPLAY_DECIMALS);
    let scaled = value
        .unsigned_abs()
        .checked_mul(3_600)
        .and_then(|rate| rate.checked_mul(10_000))
        .and_then(|rate| rate.checked_mul(display_scale))
        .context("GMTrade hourly rate overflow")?
        / pow10(MARKET_DECIMALS);
    let whole = scaled / display_scale;
    let fraction = format!(
        "{:0width$}",
        scaled % display_scale,
        width = DISPLAY_DECIMALS as usize
    )
    .trim_end_matches('0')
    .to_string();
    let unsigned = if fraction.is_empty() {
        whole.to_string()
    } else {
        format!("{whole}.{fraction}")
    };
    Ok(if value.is_negative() && scaled != 0 {
        format!("-{unsigned}")
    } else {
        unsigned
    })
}

fn authoritative_market_status(
    market: Arc<Market>,
    mark_micro: u128,
    token_decimals: u8,
) -> Result<MarketStatus> {
    let index = micro_price_to_protocol(mark_micro, token_decimals)?;
    let stable = micro_price_to_protocol(1_000_000, 6)?;
    let prices = Prices {
        index_token_price: Price {
            min: index,
            max: index,
        },
        long_token_price: Price {
            min: stable,
            max: stable,
        },
        short_token_price: Price {
            min: stable,
            max: stable,
        },
    };
    Ok(MarketModel::from_parts(market, 0).status(&prices)?)
}

fn authoritative_position_status(
    market: Arc<Market>,
    position: Arc<Position>,
    prices: &(String, String, String),
    token_decimals: u8,
) -> Result<PositionStatus> {
    let index = Price {
        min: micro_price_to_protocol(prices.1.parse()?, token_decimals)?,
        max: micro_price_to_protocol(prices.2.parse()?, token_decimals)?,
    };
    let stable = micro_price_to_protocol(1_000_000, 6)?;
    let prices = Prices {
        index_token_price: index,
        long_token_price: Price {
            min: stable,
            max: stable,
        },
        short_token_price: Price {
            min: stable,
            max: stable,
        },
    };
    let model = PositionModel::new(MarketModel::from_parts(market, 0), position)?;
    Ok(model.status(&prices)?)
}

fn protocol_signed_usd_to_micro(value: i128) -> i128 {
    value / pow10(MARKET_DECIMALS - 6) as i128
}

fn signed_mul_div(delta: i128, amount: u128, divisor: u128) -> i128 {
    let amount = i128::try_from(amount).unwrap_or(i128::MAX);
    let divisor = i128::try_from(divisor).unwrap_or(i128::MAX);
    delta.saturating_mul(amount) / divisor
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn uuid_like() -> String {
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!(
        "{:08x}-{:04x}-4{:03x}-8{:03x}-{:012x}",
        n as u32,
        (n >> 32) as u16,
        (n >> 48) as u16 & 0xfff,
        (n >> 60) as u16 & 0xfff,
        n >> 64
    )
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    let adapter = Adapter::new()?;
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    let mut stdout = tokio::io::stdout();
    while let Some(line) = lines.next_line().await? {
        if line.len() > 65_536 {
            continue;
        }
        let response = match serde_json::from_str::<Request>(&line) {
            Ok(request) => match adapter.dispatch(&request).await {
                Ok(result) => Response {
                    id: request.id,
                    ok: true,
                    result: Some(result),
                    error: None,
                },
                Err(error) => Response {
                    id: request.id,
                    ok: false,
                    result: None,
                    error: Some(ErrorBody {
                        code: "GMTRADE_ADAPTER_ERROR",
                        message: format!("{error:#}"),
                    }),
                },
            },
            Err(error) => Response {
                id: String::new(),
                ok: false,
                result: None,
                error: Some(ErrorBody {
                    code: "BAD_REQUEST",
                    message: error.to_string(),
                }),
            },
        };
        stdout
            .write_all(serde_json::to_string(&response)?.as_bytes())
            .await?;
        stdout.write_all(b"\n").await?;
        stdout.flush().await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protocol_price_conversion_preserves_micro_usd() {
        for decimals in [8, 9] {
            for value in [1u128, 1_000_000, 149_123_456, 100_000_000_000] {
                let protocol =
                    micro_price_to_protocol(value, decimals).expect("valid protocol precision");
                assert_eq!(protocol_price_to_micro(protocol, decimals), value);
            }
        }
        assert_eq!(
            micro_usd_to_protocol(1_000_000).unwrap(),
            pow10(MARKET_DECIMALS)
        );
    }

    #[test]
    fn signed_pnl_respects_direction_and_base_precision() {
        assert_eq!(
            signed_mul_div(2_000_000, 500_000_000, 1_000_000_000),
            1_000_000
        );
        assert_eq!(
            signed_mul_div(-2_000_000, 500_000_000, 1_000_000_000),
            -1_000_000
        );
    }

    #[test]
    fn launch_markets_use_explicit_base_precision() {
        assert_eq!(base_decimals("SOL"), 9);
        assert_eq!(base_decimals("BTC"), 8);
        assert_eq!(base_decimals("ETH"), 8);
    }

    #[test]
    fn protocol_factors_convert_to_conservative_basis_points() {
        assert_eq!(factor_to_bps(pow10(MARKET_DECIMALS) / 10_000), 1);
        assert_eq!(factor_to_bps(pow10(MARKET_DECIMALS) / 20_000), 1);
    }

    #[test]
    fn protocol_rates_convert_to_signed_hourly_basis_points() {
        let one_bps_per_hour_factor = pow10(MARKET_DECIMALS) / 10_000 / 3_600;
        assert_eq!(
            factor_per_second_to_hourly_bps(one_bps_per_hour_factor as i128).unwrap(),
            "0.999999"
        );
        assert_eq!(
            factor_per_second_to_hourly_bps(-(one_bps_per_hour_factor as i128)).unwrap(),
            "-0.999999"
        );
        assert_eq!(factor_per_second_to_hourly_bps(0).unwrap(), "0");
    }

    #[test]
    fn liquidation_estimate_respects_side_and_leverage() {
        assert_eq!(
            liquidation_estimate_micro(100_000_000, true, 20_000),
            55_000_000
        );
        assert_eq!(
            liquidation_estimate_micro(100_000_000, false, 20_000),
            145_000_000
        );
        assert_eq!(
            liquidation_estimate_micro(100_000_000, true, 100_000),
            95_000_000
        );
    }

    #[test]
    fn signed_protocol_usd_converts_to_micro_usd() {
        let scale = pow10(MARKET_DECIMALS - 6) as i128;
        assert_eq!(protocol_signed_usd_to_micro(2_500_000 * scale), 2_500_000);
        assert_eq!(protocol_signed_usd_to_micro(-2_500_000 * scale), -2_500_000);
    }

    #[test]
    fn integer_payloads_reject_non_integer_amounts() {
        assert_eq!(
            string_u128(&json!({"amount": "1000000"}), "amount").unwrap(),
            1_000_000
        );
        assert!(string_u128(&json!({"amount": "1.5"}), "amount").is_err());
        assert!(string_u128(&json!({}), "amount").is_err());
    }
}
