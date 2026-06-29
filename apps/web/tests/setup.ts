// jsdom provides crypto in some versions, but not all. Stub it.
if (typeof globalThis.crypto === "undefined") {
  Object.defineProperty(globalThis, "crypto", { value: {} as Crypto, configurable: true });
}
