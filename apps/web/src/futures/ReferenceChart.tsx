import { CandlestickSeries, ColorType, createChart, type UTCTimestamp } from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import type { FuturesCandlesResponse } from '../../shared/futures';

export function ReferenceChart({ data, loading, error }: { data: FuturesCandlesResponse | null; loading: boolean; error: string | null }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!host.current || !data?.candles.length) return;
    const chart = createChart(host.current, {
      autoSize: true,
      height: 360,
      layout: { background: { type: ColorType.Solid, color: '#0d1511' }, textColor: '#819288', fontFamily: 'DM Sans, sans-serif' },
      grid: { vertLines: { color: '#18231d' }, horzLines: { color: '#18231d' } },
      rightPriceScale: { borderColor: '#223129' },
      timeScale: { borderColor: '#223129', timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { color: '#85f2aa88' }, horzLine: { color: '#85f2aa88' } },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#69e59a', downColor: '#ff6f75', borderVisible: false,
      wickUpColor: '#69e59a', wickDownColor: '#ff6f75', priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });
    series.setData(data.candles.map((candle) => ({
      time: Math.floor(candle.time / 1000) as UTCTimestamp,
      open: Number(candle.openMicroUsd) / 1_000_000,
      high: Number(candle.highMicroUsd) / 1_000_000,
      low: Number(candle.lowMicroUsd) / 1_000_000,
      close: Number(candle.closeMicroUsd) / 1_000_000,
    })));
    chart.timeScale().fitContent();
    const observer = new ResizeObserver(() => chart.applyOptions({ width: host.current?.clientWidth ?? 0 }));
    observer.observe(host.current);
    return () => { observer.disconnect(); chart.remove(); };
  }, [data]);

  if (loading && !data) return <div className="futures-chart-state"><span className="futures-spinner" />Loading live reference candles</div>;
  if (error || !data?.candles.length) return <div className="futures-chart-state error"><strong>Reference chart unavailable</strong><span>{error ?? 'Phoenix returned no candles for this interval.'}</span></div>;
  return <div ref={host} className="futures-chart-canvas" aria-label={`${data.symbol} ${data.interval} candlestick chart`} />;
}
