import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractText, isMediaOnlyWithoutText } from "./client.js";

describe("extractText", () => {
  it("reads text items", () => {
    assert.equal(
      extractText({
        item_list: [{ type: 1, text_item: { text: "你好" } }],
      }),
      "你好",
    );
  });

  it("reads voice transcript when present", () => {
    assert.equal(
      extractText({
        item_list: [
          { type: 3, voice_item: { text: "语音转写" } } as never,
        ],
      }),
      "语音转写",
    );
  });

  it("detects media-only without text", () => {
    const msg = {
      item_list: [{ type: 2, image_item: {} } as never],
    };
    assert.equal(extractText(msg), null);
    assert.equal(isMediaOnlyWithoutText(msg), true);
  });

  describe("includeVoiceTranscript", () => {
    const voiceMsg = {
      item_list: [{ type: 3, voice_item: { text: "语音转写" } } as never],
    };

    it("uses the transcript by default", () => {
      assert.equal(extractText(voiceMsg), "语音转写");
      assert.equal(
        extractText(voiceMsg, { includeVoiceTranscript: true }),
        "语音转写",
      );
    });

    it("ignores the transcript when disabled", () => {
      assert.equal(
        extractText(voiceMsg, { includeVoiceTranscript: false }),
        null,
      );
      // The voice note then counts as unreadable media, which is what makes the
      // worker answer "didn't catch that" instead of chatting.
      assert.equal(
        isMediaOnlyWithoutText(voiceMsg, { includeVoiceTranscript: false }),
        true,
      );
    });

    it("still reads real text items when transcripts are disabled", () => {
      const mixed = {
        item_list: [
          { type: 1 as const, text_item: { text: "看这个" } },
          { type: 3, voice_item: { text: "语音转写" } } as never,
        ],
      };
      assert.equal(
        extractText(mixed, { includeVoiceTranscript: false }),
        "看这个",
      );
      assert.equal(extractText(mixed), "看这个\n语音转写");
    });
  });
});
