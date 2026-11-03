import { describe, expect, it } from "vitest";
import { replyError } from "../src/main/adapter/muse/driver";
import { classifyMuseReply, MUSE_TURNS_FN, SEL } from "../src/main/adapter/muse/selectors";
import { attributeMuseExtend, museSourceIsTip, type MuseCheckpoint, type MuseItem, type MuseSnapshot } from "../src/shared/museExtend";

// Spec rev 7.1 — R64 (technical failure ≠ refusal) and R58 ordered attribution of a continuation reply.

describe("AC-MEX-25 (R64): a finished Muse reply without a file is classified by what it says", () => {
  it("the 27/10 six-scene reply (upstream 502 after INTERNAL attempts) is a technical failure, not a refusal", () => {
    const reply = "I tried to generate scene 1 three times but the video service returned an upstream 502 error (INTERNAL). No scene 1 file was produced, so I could not continue to the next scenes.";
    expect(classifyMuseReply(reply)).toBe("provider_error");
    const e = replyError(reply);
    expect(e.cls).toBe("PROVIDER_ERROR");
    expect(e.detail).toMatchObject({ afterSend: true, definitive: true });
  });
  it("other technical wordings", () => {
    for (const t of ["Sorry, the image generation service is temporarily unavailable.", "The generator returned an error: status 503.", "Bad gateway from the media backend", "There was a technical issue creating the video."]) {
      expect(classifyMuseReply(t)).toBe("provider_error");
    }
  });
  it("the three real Muse replies of 27/10 23:37–00:06 (beta.29/30 on the VPS) are technical failures", () => {
    const live = [
      "Sorry, I couldn't make that video just now — the video service is overloaded at the moment, so no video was created.\n\nWant me to try again a little later?",
      "Sorry, that video didn't generate — I hit an unexpected internal error while making it, so I didn't get a finished clip back.\n\nI can't retry that same generation right now",
      // Classified CONTENT_REFUSED by beta.30 — “an unexpected error” was not a known technical wording.
      "That one didn't generate — I hit an unexpected error while making it, so I didn't get a finished clip back.\n\nI won't retry that same generation right now, but I can try a fresh take.",
    ];
    for (const t of live) {
      expect(classifyMuseReply(t)).toBe("provider_error");
      expect(replyError(t).cls).toBe("PROVIDER_ERROR");
    }
    for (const t of ["Something went wrong while rendering the clip.", "The generation failed before the video finished.", "I ran into an error creating that image."]) {
      expect(classifyMuseReply(t)).toBe("provider_error");
    }
  });
  it("a refusal worded around “can't make that video” keeps its policy reason", () => {
    expect(classifyMuseReply("I can't make that video — it would depict a real person in a harmful way.")).toBe("refused");
  });
  it("policy words win: a refusal stays CONTENT_REFUSED even if it mentions an error", () => {
    const refusal = "I can't create images of that person — it goes against our policies (error 500 is not the reason).";
    expect(classifyMuseReply(refusal)).toBe("refused");
    expect(replyError(refusal).cls).toBe("CONTENT_REFUSED");
  });
  it("quota is quota; a promised file keeps waiting; a question is unknown (never called a technical failure)", () => {
    expect(classifyMuseReply("You've reached your weekly limit.")).toBe("quota");
    expect(replyError("You've reached your weekly limit.").cls).toBe("QUOTA_LIMIT");
    expect(classifyMuseReply("Here is your video: final.mp4")).toBe("media_pending");
    expect(classifyMuseReply("Do you want it in portrait or landscape?")).toBe("unknown");
    expect(classifyMuseReply("A 1500-word story with 512 tiny details")).toBe("unknown");
  });
});

const user = (id: string, text: string): MuseItem => ({ role: "user", id, turn: `t-${id}`, text, media: [] });
const agent = (id: string, turn: string, text = "", outputs: string[] = []): MuseItem => ({
  role: "assistant",
  id,
  turn,
  text,
  media: outputs.map((o, i) => ({ output: o, src: `blob:${id}-${i}`, width: 1280, height: 720 })),
});
const snap = (items: MuseItem[], stop = false): MuseSnapshot => ({ conversation: "/thread/c1", items, stop });

const MSG = "Extend the exact video \"sandbox://workspace/v1.mp4\" above by about 10 seconds.";
const baseItems = [user("u1", "Generate a short video: boat"), agent("a1", "g1", "Working"), agent("a2", "g1", "Done", ["sandbox://workspace/v1.mp4"]), agent("a3", "g1", "Want me to animate it more?")];
const checkpoint = (extra: Partial<MuseCheckpoint> = {}): MuseCheckpoint => ({
  conversation: "/thread/c1",
  sourceTurn: "a2",
  sourceOutput: "sandbox://workspace/v1.mp4",
  baselineUsers: ["u1"],
  baselineAgents: ["a1", "a2", "a3"],
  baselineOutputs: ["sandbox://workspace/v1.mp4"],
  message: MSG,
  templateVersion: "muse-extend-v1",
  acceptedUser: null,
  ...extra,
});

describe("R57/R58: the source must be the head of its conversation", () => {
  it("a video inside the final reply group (followed by more messages of that group) is the head", () => {
    expect(museSourceIsTip(snap(baseItems), { conversation: "/thread/c1", turn: "a2", output: "sandbox://workspace/v1.mp4" })).toBeNull();
  });
  it("text-only turns after it (e.g. a continuation Muse answered with an error) keep it the head", () => {
    const failed = [...baseItems, user("u2", "Extend …"), agent("a4", "g2", "The video service returned upstream 502.")];
    expect(museSourceIsTip(snap(failed), { conversation: "/thread/c1", turn: "a2", output: "sandbox://workspace/v1.mp4" })).toBeNull();
  });
  it("any later video — validated or not — means the conversation moved on (not a UI change)", () => {
    const src = { conversation: "/thread/c1", turn: "a2", output: "sandbox://workspace/v1.mp4" };
    const moved = museSourceIsTip(snap([...baseItems, user("u2", "make another"), agent("a4", "g2", "", ["sandbox://workspace/v9.mp4"])]), src);
    expect(moved).toEqual({ reason: "Video nguồn không còn là đầu nhánh trong hội thoại Muse", ui: false });
    const unknown = [...baseItems, user("u2", "x"), { ...agent("a4", "g2"), media: [{ output: "", src: "blob:late", width: 1, height: 1 }] }];
    expect(museSourceIsTip(snap(unknown), src)?.ui).toBe(false);
    expect(museSourceIsTip(snap([...baseItems, agent("a4", "g1", "quoted", ["sandbox://workspace/v1.mp4"])]), src)).toBeNull();
  });
  it("missing message ids or reply-group ids fail closed as a UI change", () => {
    expect(museSourceIsTip(snap([{ ...baseItems[0], id: null }, ...baseItems.slice(1)]), { conversation: "/thread/c1", turn: "a2", output: "sandbox://workspace/v1.mp4" })?.ui).toBe(true);
    expect(museSourceIsTip(snap([baseItems[0], baseItems[1], { ...baseItems[2], turn: null }]), { conversation: "/thread/c1", turn: "a2", output: "sandbox://workspace/v1.mp4" })?.ui).toBe(true);
  });
});

describe("R58: ordered attribution of the continuation reply", () => {
  it("not rendered yet → not accepted; rendered (whitespace may differ) → waiting", () => {
    expect(attributeMuseExtend(checkpoint(), snap(baseItems)).kind).toBe("not_accepted");
    const a = attributeMuseExtend(checkpoint(), snap([...baseItems, user("u2", `  ${MSG.replace(/ /g, "\n ")}  `)], true));
    expect(a).toMatchObject({ kind: "waiting", acceptedUser: "u2", answered: false });
  });
  it("several assistant messages of ONE reply group with one new file → that file", () => {
    const items = [...baseItems, user("u2", MSG), agent("a4", "g2", "Extracting the last frame…"), agent("a5", "g2", "Here it is", ["sandbox://workspace/v2.mp4"]), agent("a6", "g2", "Want me to keep going?")];
    expect(attributeMuseExtend(checkpoint(), snap(items))).toMatchObject({ kind: "video", acceptedUser: "u2", answerId: "a5", media: { output: "sandbox://workspace/v2.mp4" } });
  });
  it("the old video quoted again in the reply is never the new result", () => {
    const items = [...baseItems, user("u2", MSG), agent("a4", "g2", "Source:", ["sandbox://workspace/v1.mp4"])];
    expect(attributeMuseExtend(checkpoint(), snap(items)).kind).toBe("waiting");
  });
  it("two new files, two reply groups, another user message or an answer before ours → ambiguous", () => {
    const two = [...baseItems, user("u2", MSG), agent("a4", "g2", "", ["sandbox://workspace/v2.mp4"]), agent("a5", "g2", "", ["sandbox://workspace/v3.mp4"])];
    expect(attributeMuseExtend(checkpoint(), snap(two))).toMatchObject({ kind: "ambiguous", reason: "Muse trả nhiều video — chưa xác định bản tích luỹ" });
    const groups = [...baseItems, user("u2", MSG), agent("a4", "g2", "a"), agent("a5", "g3", "", ["sandbox://workspace/v2.mp4"])];
    expect(attributeMuseExtend(checkpoint(), snap(groups)).kind).toBe("ambiguous");
    const typed = [...baseItems, user("u2", MSG), agent("a4", "g2", "ok"), user("u3", "make it red")];
    expect(attributeMuseExtend(checkpoint(), snap(typed)).kind).toBe("ambiguous");
    const early = [...baseItems, agent("a9", "g1", "late part of the old reply"), user("u2", MSG)];
    expect(attributeMuseExtend(checkpoint(), snap(early)).kind).toBe("ambiguous");
  });
  it("our message disappears after it was accepted, or a second copy appears next to it → ambiguous", () => {
    expect(attributeMuseExtend(checkpoint({ acceptedUser: "u2" }), snap(baseItems)).kind).toBe("ambiguous");
    expect(attributeMuseExtend(checkpoint({ acceptedUser: "u2" }), snap([...baseItems, user("u2", MSG), user("u7", MSG)])).kind).toBe("ambiguous");
    // A lone message with exactly our text under a new id is Muse's stored id replacing the temporary one (R68, 28/10).
    expect(attributeMuseExtend(checkpoint({ acceptedUser: "u2" }), snap([...baseItems, user("u7", MSG)]))).toMatchObject({ kind: "waiting", acceptedUser: "u7" });
  });
  it("a file without size or playback source is not ready yet", () => {
    const items = [...baseItems, user("u2", MSG), { ...agent("a4", "g2", "", ["sandbox://workspace/v2.mp4"]), media: [{ output: "sandbox://workspace/v2.mp4", src: "", width: 0, height: 0 }] }];
    expect(attributeMuseExtend(checkpoint(), snap(items)).kind).toBe("waiting");
  });
});

describe("page script keeps document order and reads the user bubble text", () => {
  it("items are in DOM order with roles; user text comes from the bubble, not the toolbar", () => {
    const mk = (role: string, id: string, text: string, bubbleText?: string) => ({
      getAttribute: (n: string) => ({ "data-message-id": id, "data-message-role": role, "data-message-turn-id": `g-${id}` })[n],
      innerText: text,
      querySelector: () => (bubbleText === undefined ? null : { innerText: bubbleText }),
      querySelectorAll: () => [],
    });
    const nodes = [mk("user", "u1", "Copy Edit\nhello", "hello"), mk("assistant", "a1", "hi")];
    const document = { querySelectorAll: () => nodes, querySelector: () => null };
    const out = new Function("document", "location", "sel", `return (${MUSE_TURNS_FN})(sel)`)(document, { pathname: "/thread/x" }, SEL);
    expect(out.items.map((i: MuseItem) => [i.role, i.id, i.text])).toEqual([["user", "u1", "hello"], ["assistant", "a1", "hi"]]);
    expect(out.users).toEqual([{ id: "u1", text: "hello" }]);
  });
  it("live 01/11: Muse's Vietnamese 'generation failed' reply is a provider error, not a refusal", () => {
    expect(classifyMuseReply("Xin lỗi, việc tạo ảnh này đã không thành công nên mình chưa có ảnh để gửi cho bạn.")).toBe("provider_error");
    expect(classifyMuseReply("Mình không tạo được video lúc này do lỗi kỹ thuật.")).toBe("provider_error");
    expect(classifyMuseReply("Đây là ảnh thẻ Q5R13 trên bàn gỗ.")).toBe("unknown");
  });
});
