// The only way the content script and popup talk to the network: every call
// goes through the background worker, which holds the token.
import type { ApiFailure, BgRequest, BgResult } from "./types";

const RELOADED: ApiFailure = {
  ok: false,
  code: "internal",
  error: "The extension was reloaded. Refresh this page and try again.",
};

export async function send<T>(message: BgRequest): Promise<BgResult<T>> {
  try {
    const response = (await chrome.runtime.sendMessage(message)) as BgResult<T> | undefined;
    if (!response) return { ok: false, code: "internal", error: "No response from the extension." };
    return response;
  } catch {
    return RELOADED;
  }
}
