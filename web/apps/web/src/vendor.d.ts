declare module 'pdfmake/build/pdfmake' {
  const pdfMake: {
    vfs: Record<string, string>;
    createPdf(docDefinition: Record<string, unknown>): {
      download(filename?: string): void;
      open(): void;
      print(): void;
      getBlob(cb: (blob: Blob) => void): void;
      getBase64(cb: (data: string) => void): void;
    };
  };
  export default pdfMake;
}

declare module 'pdfmake/build/vfs_fonts' {
  const vfs_fonts: { pdfMake: { vfs: Record<string, string> } };
  export default vfs_fonts;
}

declare module 'html-to-pdfmake' {
  function htmlToPdfmake(
    html: string,
    options?: Record<string, unknown>,
  ): unknown;
  export default htmlToPdfmake;
}
