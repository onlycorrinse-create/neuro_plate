// Сборка ответа бота из готовых фраз.
// Модель возвращает только статусы и названия продуктов (JSON), весь текст — отсюда.
// Чтобы поменять формулировку, правьте фразы в этом файле.

export const HEADER = process.env.HEADER || "Разбор по системе врача Ольги Помойнецкой";
const LINK = process.env.WEBINAR_LINK || "[ссылка]";

export const NO_PLATE = `Не вижу тарелку. Пришлите фото еды и под ним ответьте на 6 вопросов:

1. Что в тарелке? Все ингредиенты, включая соус, заправку и специи. Если что-то покупное — состав с упаковки или точное название.
2. На каком масле или жире готовили?
3. Пили что-нибудь во время еды или сразу после? Что именно и какое — холодное, тёплое, горячее? Если ничего — так и напишите.
4. Это завтрак, обед, ужин или перекус?
5. С чего начинаете есть — с какого продукта на тарелке?
6. Хватает ли этой еды до следующего приёма пищи или через пару часов тянет перекусить?`;

const DISCLAIMER = "Это не медицинская рекомендация: при заболеваниях ЖКТ питание подбирается с учётом диагноза.";

// ---------- помощники ----------
// Слот — только название продукта: обрезаем всё, что похоже на вторую мысль.
function slot(v, fallback = "", max = 90) {
  if (typeof v !== "string") return fallback;
  let s = v.replace(/\s+/g, " ").trim();
  s = s.split(/[.;!?:()\n]/)[0].trim();          // никаких предложений внутри слота
  s = s.replace(/[«»"]/g, "");
  if (s.length > max) s = s.slice(0, max).replace(/\s+\S*$/, "");
  return s || fallback;
}
// «с» → «со» перед «сл», «св», «ст», «зв», «мн» и т. п.
const so = w => (/^([сзшжщ][^аеёиоуыэюяй]|мн|вс|льд)/i.test(w || "") ? "со" : "с");
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const low = s => s ? s[0].toLowerCase() + s.slice(1) : s;
const v = (pl, one, many) => (pl ? many : one);
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
function joinList(arr) {
  if (arr.length <= 1) return arr.join("");
  return arr.slice(0, -1).join(", ") + " и " + arr[arr.length - 1];
}
const ST = { red: "🔴", yellow: "🟡", green: "🟢" };
const norm = s => (["red", "yellow", "green"].includes(s) ? s : "yellow");

// ---------- формат ответа: абзац о блюде + пункты + вопросы к вебинару ----------
const SYMPT_ORDER = ["heartburn", "bloating", "belching", "heaviness", "mucus"];
const SYMPT_ACC = { heartburn: "изжогу", bloating: "вздутие", belching: "отрыжку", heaviness: "тяжесть после еды", mucus: "ощущение слизи в горле" };
const SYMPT_GEN = { heartburn: "изжоги", bloating: "вздутия", belching: "отрыжки", heaviness: "тяжести", mucus: "слизи в горле" };

function aboutDish(sm) {
  sm = sm || {};
  const out = [];
  const name = slot(sm.name);
  if (sm.role === "dessert" || sm.role === "snack") {
    const what = sm.role === "dessert" ? "десерт" : "перекус";
    out.push(`${name ? cap(name) : "Такое блюдо"} — это скорее ${what}, чем полноценный приём пищи.`);
  }
  const many = [];
  if (sm.fast_carbs === "many") many.push("простых углеводов");
  if (sm.fat_high === true) many.push("жира");
  const minus = [];
  if (many.length) minus.push("много " + joinList(many));
  if (sm.fast_carbs === "some") minus.push(sm.protein_ok === true ? "есть и простые углеводы" : "есть простые углеводы");
  if (sm.protein_ok === false) minus.push("мало белка");
  const minusText = minus.length > 1
    ? (minus.some(x => x.includes(" и ")) ? minus.join(", ") : minus.slice(0, -1).join(", ") + " и " + minus[minus.length - 1])
    : minus.join("");
  const oil = sm.oil_unknown === true ? ", а на каком масле его жарили — непонятно" : "";
  if (sm.protein_ok === true && minus.length) out.push(`В таком блюде есть белок, но ${minusText}${oil}.`);
  else if (minus.length) out.push(`В таком блюде ${minusText}${oil}.`);
  else if (sm.protein_ok === true) out.push(`В таком блюде есть белок, а простых углеводов и лишнего жира нет${oil ? ", но на каком масле его жарили — непонятно" : ""}.`);
  else if (oil) out.push("На каком масле жарили это блюдо — непонятно.");

  const sy = SYMPT_ORDER.filter(x => Array.isArray(sm.symptoms) && sm.symptoms.includes(x));
  if (sy.length) {
    const lead = sm.inflammatory === "many" ? "Многие его ингредиенты поддерживают воспаление слизистой, поэтому при заболеваниях ЖКТ" : "При заболеваниях ЖКТ";
    out.push(`${lead} такое блюдо с большой долей вероятности вызовет ${joinList(sy.map(x => SYMPT_ACC[x]))}${sm.evening === true ? " — особенно если съесть его вечером" : ""}*.`);
    // Причины общими словами — чтобы было понятно, откуда симптомы, даже если пункты зелёные.
    const RS = { gas: "газообразующие продукты", fried: "жареное", fat: "много жира", sweet: "сладкое", dairy: "молочные продукты", starch_protein: "белок вместе с картофелем или выпечкой", portion: "большая порция", drink: "питьё за едой", fruit: "сладкие фрукты вместе с едой", processed: "фабричные продукты" };
    const rs = (Array.isArray(sm.reasons) ? sm.reasons : []).filter(x => RS[x]).filter(x => !(x === "fat" && sm.fat_high === true && many.includes("жира")));
    if (rs.length) out.push(`${rs.length > 1 ? "Причины" : "Причина"} — ${joinList(rs.map(x => RS[x]))}.`);
  } else {
    out.push("Изжоги, вздутия и тяжести от такого блюда ждать не стоит.");
  }
  const footnote = sy.length ? "* В зависимости от вашего диагноза и состояния ЖКТ на данный момент." : "";
  return { text: out.join(" ") + (footnote ? "\n" + footnote : ""), symptoms: sy, minus: minus.length > 0 || sm.oil_unknown === true, evening: sm.evening === true };
}

// Пункты. Клетчатка берётся из summary.fiber, остальное — из criteria.
function fiberItem(sm) {
  const f = (sm || {}).fiber;
  if (f === "enough") return { st: "green", text: "Клетчатки достаточно — кишечнику есть с чем работать." };
  if (f === "none") return { st: "red", text: "Клетчатки на тарелке нет, а без неё стулу не из чего формироваться и желчь густеет — отсюда запоры и вздутие после жирного." };
  return { st: "yellow", text: "Клетчатка есть, но её мало — стулу не из чего формироваться как нужно, отсюда запоры." };
}
const ITEMS = [
  {
    key: "compat", name: "Совместимость продуктов",
    red: c => c.variant === "B"
      ? "Сладкое вместо еды — это не приём пищи, а порция сахара: после него тяжесть, и скоро снова хочется есть."
      : c.variant === "C"
        ? "Сладкое вместе с едой мешает её перевариванию — после такой еды долго остаётся тяжесть."
        : "Белок вместе с картофелем или выпечкой переваривается тяжело — после такой еды долго остаётся тяжесть.",
    yellow: c => c.variant === "B"
      ? "Сладкие фрукты вместе с основной едой мешают её перевариванию — отсюда вздутие и урчание."
      : "Картофеля немного, но рядом с белком он замедляет переваривание — после еды остаётся лёгкая тяжесть.",
    green: () => "Продукты на тарелке хорошо сочетаются — пищеварению с ними легко.",
  },
  {
    key: "satiety", name: "Сытность и баланс",
    red: c => c.variant === "B"
      ? "Белок и жир здесь есть, но вместо сложных углеводов — быстрые: через пару часов сахар в крови упадёт и потянет на перекус и сладкое."
      : "Такая еда надолго не насытит: через пару часов сахар в крови упадёт и потянет на сладкое.",
    yellow: (c, ctx) => {
      if (c.variant !== "B") return "Основа для сытости есть, но быстрые углеводы рядом с ней через пару часов потянут на сладкое.";
      const M = { fat: ["жира", "именно он даёт долгую сытость"], protein: ["белка", "именно он даёт долгую сытость"], complex: ["сложных углеводов", "именно они дают ровную энергию до следующего приёма пищи"] }[c.missing];
      if (!M) return "Основа для сытости есть, но для полного баланса одного из компонентов маловато.";
      return ctx && ctx.full
        ? `Сейчас вам этой еды хватает, но для полного баланса здесь мало ${M[0]} — ${M[1]}.`
        : `Основа для сытости есть, но мало ${M[0]} — ${M[1]}, без этого через пару часов потянет перекусить.`;
    },
    green: () => "Белка, жира и сложных углеводов здесь достаточно — такой еды хватит до следующего приёма пищи.",
  },
  {
    key: "drink", name: "Напиток к еде",
    red: c => {
      const d = slot(c.drink, "напиток");
      if (c.variant === "C") return `${cap(d)} сразу после еды ${v(c.pl, "мешает", "мешают")} усвоению железа и ${v(c.pl, "разбавляет", "разбавляют")} желудочный сок — появляется тяжесть.`;
      const base = `${cap(d)} за едой ${v(c.pl, "растягивает", "растягивают")} желудок и ${v(c.pl, "разбавляет", "разбавляют")} желудочный сок — пищеварение замедляется, появляется тяжесть`;
      return c.variant === "B" ? base + ", и к тому же это сахар в жидком виде." : base + ".";
    },
    yellow: c => c.variant === "B"
      ? "Про напиток вы не написали: любая жидкость за едой разбавляет желудочный сок, и пищеварение замедляется."
      : "Даже немного жидкости за едой разбавляет желудочный сок — пищеварение идёт медленнее.",
    green: () => "За едой нет лишней жидкости — желудочный сок не разбавляется, и пища переваривается как надо.",
  },
  {
    key: "processing", name: "Переработка",
    red: c => `${cap(slot(c.items, "покупные продукты"))} — фабричная еда: клетчатки в ней мало, а добавки вредят кишечной микрофлоре — отсюда вздутие и нестабильный стул.`,
    yellow: c => `${cap(slot(c.items, "один из продуктов"))} — фабричный продукт, и добавки в ${v(c.pl, "нём", "них")} вредят кишечной микрофлоре — отсюда нестабильный стул.`,
    green: () => "Всё на тарелке — цельные продукты, приготовленные дома, добавок здесь нет.",
  },
];

export function compose(j, ctx = {}) {
  if (!j || j.plate === false) return NO_PLATE;
  const cr = j.criteria || {};
  const sm = j.summary || {};

  // Симптомы из жёлтых/красных пунктов обязательно попадают в абзац вместе с причиной,
  // чтобы абзац и пункты не противоречили друг другу.
  sm.symptoms = Array.isArray(sm.symptoms) ? sm.symptoms.slice() : [];
  sm.reasons = Array.isArray(sm.reasons) ? sm.reasons.slice() : [];
  const need = (sym, rsn) => { if (!sm.symptoms.includes(sym)) sm.symptoms.push(sym); if (!sm.reasons.includes(rsn)) sm.reasons.push(rsn); };
  const cc = cr.compat || {}, cs = norm(cc.status);
  if (cs === "yellow" && cc.variant === "B") need("bloating", "fruit");
  else if (cs === "red" && (cc.variant === "B" || cc.variant === "C")) need("heaviness", "sweet");
  else if (cs === "red" || cs === "yellow") need("heaviness", "starch_protein");
  if (norm((cr.drink || {}).status) === "red") need("heaviness", "drink");
  if (norm((cr.processing || {}).status) === "red") need("bloating", "processed");

  const lines = [HEADER, "", "🍽 " + cap(slot(j.dish, "Ваша тарелка", 240).replace(/\s*,\s*$/, "")) + ".", ""];
  const about = aboutDish(sm);
  lines.push(about.text, "");

  const got = {};
  for (const it of ITEMS) {
    const c = cr[it.key] || {};
    const st = norm(c.status);
    got[it.key] = { st, variant: c.variant, missing: c.missing };
    let text;
    try { text = it[st](c, ctx); } catch { text = it[st]({}, ctx); }
    lines.push(`${ST[st]} ${it.name} — ${text}`);
  }

  // Персональный вывод: вопросы, которые остались после разбора этой тарелки.
  const Q = [];
  const dish = slot(j.cta_dish);
  const symGen = joinList(about.symptoms.slice(0, 2).map(x => SYMPT_GEN[x]));
  const ownReasons = (sm.reasons || []).filter(x => ["inflammatory", "gas", "fried", "fat", "dairy", "portion"].includes(x));
  if (about.minus && about.symptoms.length && (ownReasons.length || sm.inflammatory === "many")) Q.push(`как собрать ${dish || "это блюдо"} так, чтобы после еды не было ${symGen}`);
  else if (about.minus && !["red", "yellow"].includes(norm((cr.satiety || {}).status))) Q.push("как сделать такую тарелку сбалансированной");
  // вопросы по причинам симптомов
  const RQ = { gas: "как готовить газообразующие продукты, чтобы не было вздутия", fried: "как готовить без жарки и не терять вкус", dairy: "какие молочные продукты можно, а какие лучше убрать", portion: "какой должна быть порция, чтобы не было тяжести", drink: "что и когда пить, чтобы не мешать пищеварению" };
  const reasons = Array.isArray(sm.reasons) ? sm.reasons : [];
  if (!about.minus && about.symptoms.length) {
    const rq = reasons.map(x => RQ[x]).filter(Boolean);
    if (rq.length) rq.slice(0, 2).forEach(q => Q.push(q));
    else if (ownReasons.length || sm.inflammatory === "many") Q.push(`почему даже такое блюдо даёт ${about.symptoms.slice(0, 2).map(x => SYMPT_ACC[x]).join(", ")} — и как это убрать`);
  }
  const sat = got.satiety || {};
  if ((sat.st === "yellow" && sat.variant !== "B") || (sat.st === "red" && sat.variant === "B")) Q.push("чем заменить быстрые углеводы, чтобы через пару часов не тянуло на сладкое");
  else if (sat.st === "yellow" && sat.variant === "B") {
    const MQ = { fat: "какие жиры и сколько добавлять в тарелку", protein: "сколько белка нужно в каждом приёме пищи", complex: "какие сложные углеводы добавить к такой тарелке" }[sat.missing];
    Q.push(MQ || "чем дополнить эту тарелку, чтобы она была сбалансированной");
  }
  else if (sat.st === "red") Q.push("из чего собрать тарелку, чтобы сытости хватало до следующего приёма пищи");
  if (about.evening) Q.push("в какое время такое блюдо лучше есть");
  const cm = got.compat || {};
  if (cm.st === "yellow" && cm.variant === "B") Q.push("когда лучше есть фрукты, чтобы не было вздутия");
  else if (cm.st === "red" && (cm.variant === "B" || cm.variant === "C")) Q.push("когда и как можно есть сладкое, чтобы не было тяжести");
  else if (cm.st === "red" || cm.st === "yellow") Q.push("какие продукты сочетаются в одной тарелке, а какие нет");
  const dr = got.drink || {};
  if ((dr.st === "red" || (dr.st === "yellow" && dr.variant !== "B")) && !Q.includes(RQ.drink)) Q.push(RQ.drink);
  const pr = got.processing || {};
  if (pr.st === "red" || pr.st === "yellow") Q.push("чем заменить фабричные продукты в повседневной еде");

  lines.push("");
  if (Q.length) {
    lines.push("Подробнее — на бесплатном практикуме Ольги Валерьевны, где мы разберём:");
    const qs = Q.slice(0, 4);
    qs.forEach((q, i) => lines.push("— " + q + (i === qs.length - 1 ? "." : ";")));
    lines.push("", `Регистрация: ${LINK}`);
  } else {
    lines.push(`Эта тарелка собрана хорошо. Как так же собрать весь рацион — разберём на бесплатном практикуме Ольги Валерьевны: ${LINK}`);
  }

  const sp = j.special;
  if (sp && typeof sp === "object") {
    let t = null;
    if (sp.kind === "child") t = "Для детей рацион подбирается индивидуально с врачом — этот разбор его не заменяет.";
    else if (sp.kind === "pregnancy") t = "При беременности рацион подбирается индивидуально с врачом — этот разбор его не заменяет.";
    else if (sp.kind === "diagnosis") t = `При ${slot(sp.label_prep, "заболеваниях ЖКТ")} рацион подбирается индивидуально с врачом — этот разбор его не заменяет.`;
    if (t) lines.push("", t);
  }
  lines.push("", DISCLAIMER);
  return lines.join("\n");
}

// Достаём JSON из ответа модели (на случай, если она обернула его в ```).
export function parseModelJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch {} }
  return null;
}
