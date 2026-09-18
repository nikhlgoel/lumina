// Monaco 0.56 moved the TypeScript language defaults into a contribution module that ships without
// type declarations. We only touch setDiagnosticsOptions, so declare exactly that rather than
// reaching for `any` or letting the import go untyped.
declare module 'monaco-editor/language/typescript/monaco.contribution' {
  interface DiagnosticsOptions {
    noSemanticValidation?: boolean;
    noSyntaxValidation?: boolean;
    noSuggestionDiagnostics?: boolean;
  }

  interface LanguageServiceDefaults {
    setDiagnosticsOptions(options: DiagnosticsOptions): void;
  }

  export const typescriptDefaults: LanguageServiceDefaults;
  export const javascriptDefaults: LanguageServiceDefaults;
}

// `editor.main` is the runtime entry (contributions + CSS) but ships no declarations of its own.
// Its surface is exactly `editor.api`, which *is* typed, so borrow those.
declare module 'monaco-editor/editor/editor.main' {
  export * from 'monaco-editor/editor/editor.api';
}
