/** Professional activity spheres — shared + pro-only `categories` rows. */

export const PROFESSIONAL_CATEGORY_SLUGS = [
  "beauty",
  "massage_wellness",
  "health",
  "fitness",
  "education",
  "childcare",
  "photo_video",
  "home_services",
  "home_food",
  "creative",
  "digital",
  "legal",
  "finance",
  "insurance",
  "real_estate",
  "auto",
  "pets",
  "events",
  "travel",
  "pro_other",
] as const;

export type ProfessionalCategorySlug =
  (typeof PROFESSIONAL_CATEGORY_SLUGS)[number];

/** Default when nothing matches — narrow bucket, not «мастера/быт». */
export const PROFESSIONAL_DEFAULT_CATEGORY_SLUG: ProfessionalCategorySlug =
  "pro_other";

type Rule = { slug: ProfessionalCategorySlug; pattern: RegExp };

/**
 * First match wins — more specific / less ambiguous patterns first.
 * English tokens use word boundaries so «Экстенсивное» ≠ stretch, etc.
 */
export const PROFESSIONAL_CATEGORY_RULES: Rule[] = [
  {
    slug: "legal",
    pattern:
      /юрист|адвокат|нотариус|\blawyer\b|\battorney\b|legalshield|\blegal\b|иммиграцион|паралегал|paralegal|убежищ|political.?asylum|\bead\b|green.?card|грин.?карт|ворк.?ауториз|work.?authoriz|натурализац|бизнес.?лиценз|licensing.?protection|adjustment.?of.?status|паспорт(а|ов)?.?рф|kalinka.?service|виза.?талант/i,
  },
  {
    slug: "beauty",
    pattern:
      /маникюр|педикюр|бровист|брови|ресниц|парикмахер|барбер|barber|визаж|макияж|косметолог|шугаринг|сахарн|восков(ая|ой).?депиляц|\bnails?\b|\blashes?\b|\bhair\b|\bmakeup\b|окрашив|стрижк|кератин|ботокс.?вол|наращиван.?вол|перманент|beauty.?room|эстетист|esthetician|филлер|dermal.?filler|увеличение.?губ|под.?глаз|уход.?за.?ногт|ногт(ями|ей|и)\b|ламинир|hair.?salon|hairsalon|russian.?manicure|skincare|процедур.{0,25}волос/i,
  },
  {
    slug: "massage_wellness",
    pattern:
      /массаж|\bspa\b|пилинг|ароматерап|антицеллюлит|телесно.?ориентир|\bwellness\b|endermolog|лимфодренаж|facial.?massage/i,
  },
  {
    slug: "photo_video",
    pattern:
      /фотограф|\bphotograph|видеограф|\bvideograph|photo.?video|фото.?съ[её]мк|видео.?съ[её]мк|съ[её]мк(а|и).?(фото|видео)|хедшот|\bheadshots?\b/i,
  },
  {
    slug: "childcare",
    pattern:
      /няня|сиделка|детск(ий|ого).?сад|kids.?club|\bchildcare\b|\bbabysit|присмотр.?за.?реб|лагерь|spring.?camp|малыш|ранн(ее|ем).?детск/i,
  },
  {
    slug: "real_estate",
    pattern:
      /риелтор|риэлтор|недвижим|\brealtor\b|real.?estate|аренда.?комнат|аренда.?дом|сдам.?мастер.?бэдрум|сдам.?комнат|сдаётся.?комнат|сдается.?комнат|bedroom.?for.?rent|room.?for.?rent|переуступка.?аренды|\bairbnb\b/i,
  },
  {
    slug: "auto",
    pattern:
      /аренда.?авто|аренда.?машин|сда(м|ю|ётся|ется).?машин|сдам.?тесл|авто.?в.?аренду|(toyota|lexus|tesla|camry|prius|suburban|chevrolet|shevrolet).{0,50}(в.?аренду|аренда)|(в.?аренду|аренда).{0,30}(toyota|lexus|tesla|camry|prius|машин|suburban)|автоброкер|авто.?брокер|\bauto.?broker\b|\bcar.?rental\b|\bturo\b|автопарк|мобильн(ый|ого).?ремонт.?авто|автосервис|автомеханик|\bmechanic\b|полировк(а|и).?авто|выездн(ая|ой).?диагностик|диагностик\w*.{0,8}авто|детейлинг|\bdetailing\b|эвакуатор|\bcdl\b|drive.?service|lease.?special|dream.?car|uber.?black|авто(мобил)?.{0,20}аукцион|аукцион.{0,20}(авто|манхейм|manheim)|прода[её]тся.?(toyota|camry|prius|honda|bmw|машин)|\bkenworth\b|\beld\b.?solution|tesla.?model|помог\w*.{0,20}(приобрести|купить).{0,20}(tesla|авто|машин)|новую.?tesla|дилерск(ий|ом).?центр|сэкономить.?тысячи/i,
  },
  {
    slug: "insurance",
    pattern:
      /страховой.?брокер|автострахов|truck.?insur|commercial.?truck|\bcargo.?insurance\b|\binsurance.?broker\b|\binsurance.?agent\b|\bauto.?insurance\b|страхован(ие|ия|ию).?(авто|жизн|здоров|бизнес|truck|cargo)|страховы(е|х).?услуг|застраховать.?commercial|подобрать.?coverage|авто\s*\/\s*страхование/i,
  },
  {
    slug: "finance",
    pattern:
      /бухгалтер|\baccountant\b|\bbookkeep|\bcpa\b|\bctec\b|\birs\b|налогов(ый|ая|ые).?(сезон|декларац|консульт)|подач(а|и).?налог|tax.?prepar|открытие.?компан|dot\/mc|\bmc\b.{0,12}\bdot\b|\bdot\b.{0,12}\bmc\b|кредитн(ую|ой|ая).?истори|credit.?score|восстановлен(ие|ием).?кредит|обмен.?рубл/i,
  },
  {
    slug: "home_services",
    pattern:
      /клининг|уборк|\bcleaning\b|чисток.?диван|чистк[аиу].{0,20}(диван|матрас|ковр)|ковролин|замочник|\blocksmith\b|сантехник|электрик|хендимен|\bhandyman\b|ремонт.?квартир|ремонт.?дом|ремонт.?ванн|генеральн.?подряд|building.?licen|реставрац(ия|ии).?кож|сборка.?мебел|химчистк.?диван|покр(аска|аске|аски).?(дом|жил|квартир)|поокраске|\bpaving\b|\bconstruction\b|home.?repair|pressure.?washing|мойка.?под.?давлен|бетонн|ирригац|дренаж|благоустрой|брусчатк|подпорн|\barchitect\b|архитектор|ремонт\s*\/\s*стройка|наводит.?чистот|консультация.?по.?ac|\bmoving\b|переезд|грузчик|relocation/i,
  },
  {
    slug: "health",
    pattern:
      /психолог|гипнотерапевт|психотерап|психиатр|логопед|нейропсихолог|\btherapist\b|стоматолог|osteopath|\bosteo\b|chiropract|dentis|\bdoctor\b|анестезиолог|функциональн(ый|ого).?диагност|грудн(ое|ому).?вскармлив|выездн(ой|ого).?забор.?кров|лабораторн(ые|ых).?анализ|пиявоч|гирудотер|semaglutide|tirzepatide|\bozempic\b|пептиды/i,
  },
  {
    slug: "fitness",
    pattern:
      /фитнес.?тренер|персональн(ый|ые).?трен|онлайн.?тренер|\bpersonal.?train|йог[аиуе]|\byoga\b|pilates|пилатес|уроки.?плаван|тренер.?по.?плаван|индивидуальн(ые|ых).?уроки.?плаван|\bswimming\b|волейбол|\bstretching\b|\bstretch\b|растяжк|теннис|фигурн(ое|ым).?катан|\bdance.?studio\b|танцев(альный|альной).?студи|спортзал|шведск(ая|ие).?стен|тренер.?по.?питан/i,
  },
  {
    slug: "education",
    pattern:
      /репетитор|преподаватель|учительниц|\btutor\b|учитель(?!\s*йог)|английск(ий|ого|ому|им)|англійськ|русск(ий|им|ому).?язык|\bmath\b.?tutor|репетитор.?по.?мат|подготовк(а|е).?к.?sat|автоинструктор|сдать.?на.?вожден|\bdmv\b|устн(ый|ые).?перевод|переводчик(?!\s*документ)|уроки.?инглиш|уроки.?англ|инглиш|\benglish\b.?(lesson|teacher|language|instruction)|преподаю|занятия.?по.?англий|разговорн(ый|ые).?(испан|англий|франц)|испанск(ий|ого)|француз(ский|ька|узьк)|уроки.?гитар|уроки.?барабан|занятия.?по.?барабан|занятия.?по.?гитар|музыкальн|школа.?программирован|онлайн.?школа.?програм|python.?·|уроки.?музык/i,
  },
  {
    slug: "home_food",
    pattern:
      /выпечк|торт|пеку|\bbake\b|\bcakes?\b|кондитер|домашн(яя|ей).?еда|пирож|кулинар|\bpastry\b|икра|форель|блинчик|копчён|копчен|пельмен|пасочк|халял|инжир|шоколадн(ая|ой).?колбас|кулич|медовик|кейтеринг|\bcatering\b|sweet.?bakery|заварной.?крем/i,
  },
  {
    slug: "creative",
    pattern:
      /иллюстратор|графическ(ий|ого).?дизайн|дизайнер|handmade|вяжу|вязан|свеч|\bcandle\b|\bsmm\b|тату|\btattoo\b|таргетолог|таргет(ированн|ированная)?|image.?consult|маркетинг|\bmarketing\b|\bcasting\b/i,
  },
  {
    slug: "digital",
    pattern:
      /создан(ие|ия).?сайт|сайт(ов)?\+|web.?design|web.?&.?seo|\bseo\b.?optim|автоматиз\w*.{0,20}(продаж|бизнес)|telegram.{0,30}ai|\bai\s*agent\b|разработчик|программист|\bit\s*specialist\b|digital.?product/i,
  },
  {
    slug: "pets",
    pattern:
      /грумер|ветеринар|dog.?walk|pet.?sit|pet.?board|животн|собак|кошк|\bzoo\b/i,
  },
  {
    slug: "events",
    pattern:
      /тамада|event.?plan|декоратор|организатор.?праздн|воздушн(ые|ых).?шар|party.?decor|аниматор|цветочн|flower.?boutique|\bbouquet\b|kids.?party|детск(ие|их).?праздник|букет(ы|ов)?\b|karaoke|караоке/i,
  },
  {
    slug: "travel",
    pattern:
      /турагент|travel.?agent|визов(ый|ая|ые)|туризм|\bvisa\b.?serv|экскурсионн|тур(ы|ов).?на.?русск|рыбалк|гавай|оаху|big.?bear|частн\w*.?трансфер|премиум.?такси|private.?driver|школьный.?трансфер|аэропорт.?\/.?oc/i,
  },
];

export function inferProfessionalCategorySlug(
  ...texts: Array<string | null | undefined>
): ProfessionalCategorySlug {
  const blob = texts.filter(Boolean).join("\n");
  if (!blob.trim()) return PROFESSIONAL_DEFAULT_CATEGORY_SLUG;
  for (const rule of PROFESSIONAL_CATEGORY_RULES) {
    if (rule.pattern.test(blob)) return rule.slug;
  }
  return PROFESSIONAL_DEFAULT_CATEGORY_SLUG;
}
