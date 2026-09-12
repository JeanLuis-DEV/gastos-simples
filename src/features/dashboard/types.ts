import type { Category, FinancialProfile, Transaction } from "../../domain/models";

export type View =
  | "dashboard"
  | "transactions"
  | "categories"
  | "calculator"
  | "settings";
export type FeedbackProps = {
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
  onMessage: (message: string) => void;
};
export type DataProps = FeedbackProps & {
  ownerUid: string;
  categories: Category[];
  profiles?: FinancialProfile[];
  items: Transaction[];
};
