import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSync } from "./useSync";

const snapshot = { status: "disabled" };
const manager = {
  start: vi.fn(),
  stop: vi.fn(),
  subscribe: vi.fn(() => () => undefined),
  getSnapshot: vi.fn(() => snapshot),
};

vi.mock("./engine", () => ({ getSyncManager: () => manager }));

function Probe({ allowed }: { allowed: boolean }) {
  useSync("owner", allowed);
  return null;
}

describe("useSync", () => {
  afterEach(() => vi.clearAllMocks());

  it("não inicia o engine nem requests para contas fora do canário", () => {
    render(<Probe allowed={false} />);
    expect(manager.start).not.toHaveBeenCalled();
    expect(manager.stop).toHaveBeenCalledOnce();
  });

  it("inicia o engine para a conta administrativa autorizada", () => {
    const view = render(<Probe allowed />);
    expect(manager.start).toHaveBeenCalledOnce();
    view.unmount();
    expect(manager.stop).toHaveBeenCalledOnce();
  });
});
