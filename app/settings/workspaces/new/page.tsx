import type { Metadata } from "next";
import { CreateWorkspaceForm } from "../CreateWorkspaceForm";

export const metadata: Metadata = { title: "New workspace — LedgerFlow" };

export default function NewWorkspacePage() {
  return (
    <div className="py-6">
      <CreateWorkspaceForm first={false} />
    </div>
  );
}
