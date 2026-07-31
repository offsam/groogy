/**
 * Translate event title/description EN → RU for affiche publish.
 * Re-exports the shared entity translator.
 */
import "server-only";

export {
  translateCopyToRu as translateEventCopyToRu,
  translateCopyToRu,
  looksMostlyCyrillic,
  needsTranslationToRu,
  type TranslatedCopy,
  type TranslatedCopy as TranslatedEventCopy,
} from "@/lib/content/translate-copy-to-ru";
