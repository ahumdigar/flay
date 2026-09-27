# Flay bigint-buffer compatibility module

This private package replaces `bigint-buffer@1.1.5`, whose optional native binding has an unpatched out-of-bounds read. It implements the same four public conversion functions in bounded JavaScript, rejects negative or overflowing writes, and has no install script or native code. `@solana/buffer-layout-utils` consumes this package through npm's root override.
