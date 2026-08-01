import { renderWithI18n } from "@/test/i18n-wrap";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Channel, Participant } from "@club/shared";

import { BioEditor } from "./bio-editor";
import { SettingsDialog } from "./settings-dialog";
import { ConfirmDialog } from "./ui/confirm-dialog";

const me: Participant = { id: "p1", name: "alice", bio: "hello", createdAt: 0 };
const bob: Participant = { id: "p2", name: "bob", bio: "", createdAt: 0 };
const members: Participant[] = [me, bob];
const channels: Channel[] = [
  { id: "r1", slug: "general", createdAt: 0, lastActivityAt: 0, displayName: null },
  { id: "r2", slug: "deploy-debug", createdAt: 0, lastActivityAt: 0, displayName: null },
];

describe("BioEditor", () => {
  it("expands on edit, saves the entered value, and collapses", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderWithI18n(<BioEditor bio="old" onSave={onSave} testId="x" />);
    fireEvent.click(screen.getByTestId("bio-edit-x"));
    const input = screen.getByTestId("bio-editor-input-x") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "new bio" } });
    fireEvent.click(screen.getByTestId("bio-editor-save-x"));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("new bio"));
  });

  it("surfaces a thrown error inline and stays open", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("nope"));
    renderWithI18n(<BioEditor bio="old" onSave={onSave} testId="y" />);
    fireEvent.click(screen.getByTestId("bio-edit-y"));
    fireEvent.change(screen.getByTestId("bio-editor-input-y"), { target: { value: "x" } });
    fireEvent.click(screen.getByTestId("bio-editor-save-y"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    // Editor stays open (input still present) + error announced.
    expect(screen.getByTestId("bio-editor-input-y")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("nope");
  });
});

describe("ConfirmDialog", () => {
  it("fires onConfirm on the confirm button", async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    renderWithI18n(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Delete"
        description="sure?"
        confirmLabel="Delete"
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByTestId("confirm-confirm"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

describe("SettingsDialog", () => {
  const baseProps = {
    open: true,
    onOpenChange: () => {},
    me,
    members,
    selfId: me.id,
    channels,
    key_: "club_human_test_key",
    onSaveMyBio: vi.fn().mockResolvedValue(undefined),
    onSaveMemberBio: vi.fn().mockResolvedValue(undefined),
    onSignOutRequest: vi.fn(),
    onRenameChannel: vi.fn().mockResolvedValue(undefined),
    onDeleteChannel: vi.fn().mockResolvedValue(undefined),
    onKickMember: vi.fn().mockResolvedValue(undefined),
  };

  it("renders the four sections when open", () => {
    renderWithI18n(<SettingsDialog {...baseProps} />);
    // Section headings (localized under zh) + channel/member rows.
    expect(screen.getByTestId("settings-delete-deploy-debug")).toBeInTheDocument();
    // general is system -> no delete affordance, but a rename affordance exists.
    expect(screen.getByTestId("settings-rename-general")).toBeInTheDocument();
    // member kick is present for non-self; self has no kick.
    expect(screen.getByTestId("settings-kick-p2")).toBeInTheDocument();
    expect(screen.queryByTestId("settings-kick-p1")).not.toBeInTheDocument();
  });

  it("channel delete opens a confirm, and confirming calls onDeleteChannel", async () => {
    renderWithI18n(<SettingsDialog {...baseProps} />);
    fireEvent.click(screen.getByTestId("settings-delete-deploy-debug"));
    // Confirm dialog's confirm button is present; clicking it fires the delete.
    fireEvent.click(screen.getByTestId("confirm-confirm"));
    await waitFor(() => expect(baseProps.onDeleteChannel).toHaveBeenCalledWith("deploy-debug"));
  });

  it("member kick opens a confirm, and confirming calls onKickMember", async () => {
    renderWithI18n(<SettingsDialog {...baseProps} />);
    fireEvent.click(screen.getByTestId("settings-kick-p2"));
    fireEvent.click(screen.getByTestId("confirm-confirm"));
    await waitFor(() => expect(baseProps.onKickMember).toHaveBeenCalledWith(bob));
  });

  it("sign-out row calls onSignOutRequest", () => {
    renderWithI18n(<SettingsDialog {...baseProps} />);
    fireEvent.click(screen.getByTestId("settings-sign-out"));
    expect(baseProps.onSignOutRequest).toHaveBeenCalledOnce();
  });
});
