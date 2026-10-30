// solid/source/jsx-runtime.ts
import { createComponent, createElement, spread } from "@defai-digital/ax-tui/solid";
function normalizeProps(props) {
  if (!props) {
    return {};
  }
  if (!("key" in props)) {
    return props;
  }
  const { key: _key, ...rest } = props;
  return rest;
}
function createIntrinsicElement(type, props) {
  const element = createElement(type);
  spread(element, props);
  return element;
}
function jsx(type, props = {}) {
  const normalizedProps = normalizeProps(props);
  if (typeof type === "function") {
    return createComponent(type, normalizedProps);
  }
  return createIntrinsicElement(type, normalizedProps);
}
function jsxDEV(type, props = {}) {
  return jsx(type, props);
}
function Fragment(props) {
  return props.children ?? null;
}
export {
  Fragment,
  jsxDEV
};
