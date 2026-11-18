/**
 * This file contains the configuration for the defaulttree-sitter parsers.
 * It is used by ./assets/update.ts to generate the default-parsers.ts file.
 * For changes here to be reflected in the default-parsers.ts file, you need to run `bun run ./assets/update.ts`
 */
export default {
  parsers: [
    {
      filetype: "javascript",
      aliases: ["javascriptreact"],
      wasm: "https://github.com/tree-sitter/tree-sitter-javascript/releases/download/v0.25.0/tree-sitter-javascript.wasm",
      queries: {
        highlights: [
          {
            url: "https://raw.githubusercontent.com/tree-sitter/tree-sitter-javascript/44c892e0be055ac465d5eeddae6d3e194424e7de/queries/highlights.scm",
            sha256: "d3630ae6dc9b2b27b230b5f8bb92b05cd491fb12bff353dae62a0a6d780461ee",
          },
        ],
      },
    },
    {
      filetype: "typescript",
      aliases: ["typescriptreact"],
      wasm: "https://github.com/tree-sitter/tree-sitter-typescript/releases/download/v0.23.2/tree-sitter-typescript.wasm",
      queries: {
        highlights: [
          {
            url: "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/cf12346a3414fa1b06af75c79faebe7f76df080a/queries/ecma/highlights.scm",
            sha256: "37834547ebaa9c160cad87eabd38387d4722b1b40d44bab54d8e71d1feff9b9e",
          },
          {
            url: "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/cf12346a3414fa1b06af75c79faebe7f76df080a/queries/typescript/highlights.scm",
            sha256: "0caa2987e274d06aeb8f9a8a521c8348fc0dd92683b52a303338d066f0432137",
          },
        ],
      },
    },
    {
      filetype: "markdown",
      wasm: "https://github.com/tree-sitter-grammars/tree-sitter-markdown/releases/download/v0.5.1/tree-sitter-markdown.wasm",
      queries: {
        highlights: [
          // Using local file to preserve custom modifications
          "./../../../assets/markdown/highlights.scm",
        ],
        injections: [
          {
            url: "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/cf12346a3414fa1b06af75c79faebe7f76df080a/queries/markdown/injections.scm",
            sha256: "8d04801d305bb0a6ea2f97a064c2a876fd1c080d1ae553090ea643bd3f198bf3",
          },
        ],
      },
      injectionMapping: {
        nodeTypes: {
          inline: "markdown_inline",
          pipe_table_cell: "markdown_inline",
        },
        infoStringMap: {
          javascript: "javascript",
          js: "javascript",
          jsx: "javascriptreact",
          javascriptreact: "javascriptreact",
          typescript: "typescript",
          ts: "typescript",
          tsx: "typescriptreact",
          typescriptreact: "typescriptreact",
          markdown: "markdown",
          md: "markdown",
        },
      },
    },
    {
      filetype: "markdown_inline",
      wasm: "https://github.com/tree-sitter-grammars/tree-sitter-markdown/releases/download/v0.5.1/tree-sitter-markdown_inline.wasm",
      queries: {
        highlights: [
          // NOTE: Based on the last working version of the query, newer versions are adapted to neovim breaking changes
          // "https://raw.githubusercontent.com/nvim-treesitter/nvim-treesitter/99ddf573531c4dbe53f743ecbc1595af5eb1d32f/queries/markdown_inline/highlights.scm",
          "./../../../assets/markdown_inline/highlights.scm",
        ],
      },
    },
  ],
}
