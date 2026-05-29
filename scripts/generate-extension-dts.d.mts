// Types for the JS codegen module so the TypeScript test can import it under
// allowJs:false. The implementation lives in generate-extension-dts.mjs.
export function generateExtensionDts(contractsSource: string, contractNames: readonly string[]): string;
