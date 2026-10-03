import { expect, it } from "vitest";
import { loadOnnxProvider } from "../adapters/embeddings/onnx-runtime.js";
const path = process.env.VM_ONNX_QUALITY_MODEL_PATH;
it.skipIf(!path)(
  "ranks a German paraphrase in the top three with an explicitly provided multilingual model",
  async () => {
    const provider = await loadOnnxProvider(path!);
    try {
      const texts = [
        "Die Freigabe erfolgt erst, nachdem zwei Personen den Vertrag geprüft haben.",
        "Zwei Personen arbeiten an einer Vertragsvorlage.",
        "Der Drucker benötigt eine neue Patrone.",
        "Der Vertrag läuft bis Dezember.",
        "Die Personenzahl im Meeting ist auf zwei begrenzt.",
      ];
      const [query] = await provider.embed(
        ["Welche Voraussetzung gilt für die Genehmigung des Vertrags?"],
        "query",
      );
      const docs = await provider.embed(texts);
      const ranked = docs
        .map((v, index) => ({ index, score: v.reduce((sum, x, d) => sum + x * query![d]!, 0) }))
        .sort((a, b) => b.score - a.score);
      expect(ranked.slice(0, 3).map((r) => r.index)).toContain(0);
    } finally {
      await provider.close();
    }
  },
);
