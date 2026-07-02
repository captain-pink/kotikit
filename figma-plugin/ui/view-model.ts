export interface ToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

type ChecklistStatus = "pending" | "ready" | "done" | "attention";

interface ChecklistItem {
  id: string;
  label: string;
  status: ChecklistStatus;
  detail: string;
}

interface ReviewSummary {
  open: number;
  fixed: number;
  pendingReplies: number;
  needsDecision: number;
  unmapped: number;
}

export interface DashboardModel {
  statusText: string;
  checklist: ChecklistItem[];
  reviewSummary: ReviewSummary | null;
}

interface DoctorDetail {
  ok: boolean;
}

interface ReviewReportDetail {
  summary?: Partial<ReviewSummary>;
}

export interface DashboardInput {
  connected: boolean;
  tools: string[];
  doctor: ToolResult | null;
  reviewReport: ToolResult | null;
}

const emptySummary: ReviewSummary = {
  open: 0,
  fixed: 0,
  pendingReplies: 0,
  needsDecision: 0,
  unmapped: 0,
};

export function detailFromToolResult<T = unknown>(result: ToolResult): T | null {
  const text = result.content[0]?.text ?? "";
  const jsonStart = text.indexOf("\n\n");
  if (jsonStart === -1) return null;
  try {
    return JSON.parse(text.slice(jsonStart + 2)) as T;
  } catch {
    return null;
  }
}

const doctorStatus = (result: ToolResult | null): ChecklistItem => {
  const detail = result ? detailFromToolResult<DoctorDetail>(result) : null;
  if (result === null) {
    return {
      id: "doctor",
      label: "Setup health",
      status: "pending",
      detail: "Not checked",
    };
  }
  if (result.isError || detail?.ok === false) {
    return {
      id: "doctor",
      label: "Setup health",
      status: "attention",
      detail: "Needs attention",
    };
  }
  return {
    id: "doctor",
    label: "Setup health",
    status: "done",
    detail: "Ready",
  };
};

const reviewSummaryFrom = (result: ToolResult | null): ReviewSummary | null => {
  const detail = result ? detailFromToolResult<ReviewReportDetail>(result) : null;
  if (detail?.summary === undefined) return null;
  return {
    open: detail.summary.open ?? 0,
    fixed: detail.summary.fixed ?? 0,
    pendingReplies: detail.summary.pendingReplies ?? 0,
    needsDecision: detail.summary.needsDecision ?? 0,
    unmapped: detail.summary.unmapped ?? 0,
  };
};

const reviewStatus = (result: ToolResult | null): ChecklistItem => {
  if (result === null) {
    return {
      id: "review",
      label: "Review report",
      status: "pending",
      detail: "Not loaded",
    };
  }
  if (result.isError) {
    return {
      id: "review",
      label: "Review report",
      status: "attention",
      detail: "Could not load",
    };
  }
  const summary = reviewSummaryFrom(result) ?? emptySummary;
  return {
    id: "review",
    label: "Review report",
    status: "done",
    detail: `${summary.open} open, ${summary.fixed} fixed`,
  };
};

const replyStatus = (summary: ReviewSummary | null): ChecklistItem => {
  if (summary === null) {
    return {
      id: "replies",
      label: "Comment replies",
      status: "pending",
      detail: "Not loaded",
    };
  }
  return {
    id: "replies",
    label: "Comment replies",
    status: summary.pendingReplies > 0 ? "attention" : "done",
    detail: `${summary.pendingReplies} pending`,
  };
};

export function buildDashboardModel(input: DashboardInput): DashboardModel {
  const summary = reviewSummaryFrom(input.reviewReport);
  return {
    statusText: input.connected ? "Connected" : "Disconnected",
    checklist: [doctorStatus(input.doctor), reviewStatus(input.reviewReport), replyStatus(summary)],
    reviewSummary: summary,
  };
}
