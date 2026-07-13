import '@testing-library/jest-dom/vitest';

// jsdom's Blob implementation (as of jsdom 24) does not implement the spec'd
// `arrayBuffer()`/`text()` instance methods (only `slice()`), which breaks
// any code — product or test — that reads a Blob's bytes directly. Polyfill
// both via FileReader, which jsdom *does* implement correctly against its
// internal Blob storage.
if (typeof Blob !== 'undefined' && typeof Blob.prototype.arrayBuffer !== 'function') {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

if (typeof Blob !== 'undefined' && typeof Blob.prototype.text !== 'function') {
  Blob.prototype.text = function text(this: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}

// jsdom does not implement URL.createObjectURL / URL.revokeObjectURL at all.
// Individual test files have historically worked around this per-file via
// `Object.defineProperty(URL, 'createObjectURL', ...)`, but `vi.spyOn` (used
// by e.g. CustomFontsProvider.test.tsx) requires the property to already
// exist before it can be spied on/mocked. Define no-op stubs once here so
// both `vi.spyOn(URL, 'createObjectURL')` and direct calls work everywhere;
// individual tests remain free to override the return value.
if (typeof URL !== 'undefined' && typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = () => 'blob:mock-url';
}
if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL !== 'function') {
  URL.revokeObjectURL = () => {};
}
