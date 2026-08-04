export type WorkflowJsonPrimitive = null | boolean | number | string;

export type WorkflowJsonValue =
  | WorkflowJsonPrimitive
  | readonly WorkflowJsonValue[]
  | { readonly [key: string]: WorkflowJsonValue };
