/**
 * `workflowSources.mjs` 的类型声明（供 TS 侧消费者，例如单元测试，直接 import 该 .mjs 时使用）。
 * 运行时实现见同目录 workflowSources.mjs。
 */
export interface WorkflowFileSpan {
  file: string;
  start: number;
  end: number;
}
export interface WorkflowSlice extends WorkflowFileSpan {
  text: string;
}
export declare const WORKFLOW_FILES: readonly string[];
export declare const WORKFLOW_OUT_OF_SCOPE: Readonly<Record<string, string>>;
export declare function readWorkflowSources(root?: string): string;
export declare function readWorkflowFile(relativePath: string, root?: string): string;
export declare function workflowFileSpans(root?: string): WorkflowFileSpan[];
export declare function sliceWorkflowFile(
  relativePath: string,
  fromMarker: string,
  toMarker?: string,
  root?: string,
): WorkflowSlice;
export declare function sliceWorkflowMarker(
  fromMarker: string,
  toMarker?: string,
  root?: string,
): WorkflowSlice;
export declare function assertSpanWithinSingleFile(start: number, end: number, root?: string): string;