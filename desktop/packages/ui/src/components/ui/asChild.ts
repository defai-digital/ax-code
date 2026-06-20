import * as React from "react";

export type AsChildProps = { asChild?: boolean };

export type AsChildRenderProps = {
  render?: React.ReactElement;
  children?: React.ReactNode;
};

export const renderFromAsChild = (asChild: boolean | undefined, children: React.ReactNode): AsChildRenderProps => {
  if (asChild && React.isValidElement(children)) {
    return { render: children as React.ReactElement };
  }
  return { children };
};
