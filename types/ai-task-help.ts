import { TaskPriority } from "@/types/task";

export interface AiTaskHelpTaskInput {
  id: string;
  title: string;
  category: string;
  description: string;
  priority: TaskPriority;
  estimateMin: number;
  dueDate: string;
  dueInDays: number;
  systemScore: number;
}

export interface AiTaskHelpClarification {
  question: string;
  answer: string;
}

export interface AiTaskHelpResult {
  status: "answer" | "needs_clarification";
  understanding: string;
  answer: string;
  clarificationQuestion: string;
  missingContext: string[];
  actionPlan: string[];
  artifactTitle: string;
  artifact: string;
  model: string;
}

export interface AiTaskHelpApiResponse {
  enabled: boolean;
  result: AiTaskHelpResult | null;
  error: string | null;
}
