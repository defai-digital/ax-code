import DOMPurify from "dompurify"

// Defense-in-depth for LLM-generated mermaid diagrams: the SVG returned by
// beautiful-mermaid is untrusted input that gets injected via
// dangerouslySetInnerHTML, so sanitize it against the SVG profile before use.
export const sanitizeMermaidSvg = (svg: string): string =>
  DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    RETURN_TRUSTED_TYPE: false,
  })
