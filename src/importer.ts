import { createDraft, DomainError, platformUrl, TEST_PLATFORM_RESTAURANT_ID } from './core';
import { config } from './config';
import { enqueueDesign } from './designer';
import { questionnaireAnswers } from './schemas';
import { store } from './store';
import { downloadImage } from './uploads';
import { yumco, yumcoEnabled, type YumcoSubmission } from './yumco';

/**
 * Questionnaires remplis depuis un lien : récupérés sur l'API Yumco (le restaurant y est déjà créé), images copiées en
 * local, puis dossier créé et design lancé, comme pour un formulaire rempli dans le cockpit.
 */
const importSubmission = async (s: YumcoSubmission) => {
  if (!s.restaurant_id) throw new DomainError(`Questionnaire ${s.id} sans restaurant`, 500);
  // Déjà importé (le cockpit s'est arrêté avant de le signaler à l'API) : on le signale seulement.
  if (!store.snapshot.drafts.some((d) => d.yumcoRestaurantId === s.restaurant_id)) {
    const logo = s.answers.logo ? await downloadImage(s.answers.logo) : null;
    const images = [];
    for (const img of s.answers.images) images.push({ ...img, file: await downloadImage(img.file) });
    const answers = questionnaireAnswers.parse({ ...s.answers, logo, images });
    const { draft, version } = store.mutate((ctx) =>
      createDraft(ctx, answers, {
        platformUrl: s.platform_url ?? platformUrl(TEST_PLATFORM_RESTAURANT_ID),
        plan: s.subscription_plan,
        source: 'link',
        yumcoRestaurantId: s.restaurant_id,
      }),
    );
    enqueueDesign(draft.id, version.id);
    console.log(`[import] ${answers.name} (restaurant Yumco n° ${s.restaurant_id}, offre ${s.subscription_plan}) : design lancé`);
  }
  await yumco.markImported(s.id);
};

let running = false;

export const importSubmissions = async () => {
  if (running || !yumcoEnabled()) return;
  running = true;
  try {
    for (const submission of await yumco.listSubmissions()) {
      // Un questionnaire en erreur n'empêche pas les suivants ; il sera retenté au prochain passage.
      await importSubmission(submission).catch((err) => console.error(`[import] questionnaire ${submission.id} non importé :`, (err as Error).message));
    }
  } catch (err) {
    console.error('[import] questionnaires non récupérés :', (err as Error).message);
  } finally {
    running = false;
  }
};

export const startImporter = () => {
  if (!yumcoEnabled()) {
    console.log('[import] API Yumco non configurée (YUMCO_API_KEY) : questionnaires par lien désactivés');
    return;
  }
  console.log(`[import] questionnaires par lien : vérification toutes les ${Math.round(config.importIntervalMs / 1000)} s sur ${config.yumcoApiUrl}`);
  void importSubmissions();
  setInterval(() => void importSubmissions(), config.importIntervalMs).unref();
};
