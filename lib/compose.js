// Сборка ответа бота из готовых фраз.
// Модель возвращает только статусы и названия продуктов (JSON), весь текст — отсюда.
// Чтобы поменять формулировку, правьте фразы в этом файле.

export const HEADER = process.env.HEADER || "Разбор по системе врача-гастроэнтеролога Ольги Валерьевны";
const LINK = process.env.WEBINAR_LINK || "[ссылка]";

export const NO_PLATE = `Не вижу тарелку. Пришлите фото еды и под ним ответьте на 6 вопросов:

1. Что в тарелке? Все ингредиенты, включая соус, заправку и специи. Если что-то покупное — состав с упаковки или точное название.
2. На каком масле или жире готовили?
3. Пили что-нибудь во время еды или сразу после? Что именно и какое — холодное, тёплое, горячее? Если ничего — так и напишите.
4. Это завтрак, обед, ужин или перекус?
5. С чего начинаете есть — с какого продукта на тарелке?
6. Хватает ли этой еды до следующего приёма или через пару часов тянет перекусить?`;

const DISCLAIMER = "Это не медицинская рекомендация: при заболеваниях ЖКТ питание подбирается с учётом диагноза.";

// ---------- помощники ----------
// Слот — только название продукта: обрезаем всё, что похоже на вторую мысль.
function slot(v, fallback = "") {
  if (typeof v !== "string") return fallback;
  let s = v.replace(/\s+/g, " ").trim();
  s = s.split(/[.;!?:()\n]/)[0].trim();          // никаких предложений внутри слота
  s = s.replace(/[«»"]/g, "");
  if (s.length > 90) s = s.slice(0, 90).replace(/\s+\S*$/, "");
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

// ---------- описание блюда (абзац) ----------
const SYMPT_ORDER = ["heartburn", "bloating", "belching", "heaviness", "mucus"];
const SYMPT_ACC = { heartburn: "изжогу", bloating: "вздутие", belching: "отрыжку", heaviness: "тяжесть после еды", mucus: "ощущение слизи в горле" };
const SYMPT_GEN = { heartburn: "изжоги", bloating: "вздутия", belching: "отрыжки", heaviness: "тяжести", mucus: "слизи в горле" };

function summaryParagraph(sm) {
  sm = sm || {};
  const out = [];
  const name = slot(sm.name);
  if (sm.role === "dessert" || sm.role === "snack") {
    const what = sm.role === "dessert" ? "десерт" : "перекус";
    out.push(`${name ? cap(name) : "Такое блюдо"} — это скорее ${what}, чем полноценный приём пищи.`);
  }
  // «В таком блюде много простых углеводов и жира, мало белка, а на каком масле его жарили — непонятно.»
  const many = [];
  if (sm.fast_carbs === "many") many.push("простых углеводов");
  if (sm.fat_high === true) many.push("жира");
  const parts = [];
  if (many.length) parts.push("много " + joinList(many));
  if (sm.fast_carbs === "some") parts.push("есть простые углеводы");
  if (sm.protein_low === true) parts.push("мало белка");
  const list = parts.length > 1 ? parts.slice(0, -1).join(", ") + ", " + parts[parts.length - 1] : parts.join("");
  if (parts.length && sm.oil_unknown === true) out.push(`В таком блюде ${list}, а на каком масле его жарили — непонятно.`);
  else if (parts.length) out.push(`В таком блюде ${list}.`);
  else if (sm.oil_unknown === true) out.push("По составу блюдо сбалансировано, но на каком масле его жарили — непонятно.");
  else out.push("По составу блюдо сбалансировано.");

  const sy = SYMPT_ORDER.filter(x => Array.isArray(sm.symptoms) && sm.symptoms.includes(x));
  const lead = sm.inflammatory === "many" ? "Многие его ингредиенты поддерживают воспаление слизистой, поэтому при заболеваниях ЖКТ"
    : sm.inflammatory === "some" ? "Один из ингредиентов раздражает слизистую, поэтому при заболеваниях ЖКТ"
    : "При заболеваниях ЖКТ";
  if (sy.length) {
    out.push(`${lead} такое блюдо с большой долей вероятности вызовет ${joinList(sy.map(x => SYMPT_ACC[x]))}${sm.evening === true ? " — особенно если съесть его вечером" : ""}.`);
  } else {
    out.push("Изжоги, вздутия и тяжести от такого блюда ждать не стоит.");
  }
  return { text: out.join(" "), symptoms: sy };
}

// ---------- банк фраз пунктов ----------
// Каждая функция получает объект пункта из JSON модели: {status, variant, ...слоты, pl}
const BANK = [
  {
    key: "compat", name: "Совместимость продуктов",
    red: c => c.variant === "B"
      ? "Сладкое вместо еды — это не приём пищи, а порция сахара: после него тяжесть, и скоро снова хочется есть."
      : "Продукты на тарелке плохо сочетаются между собой — пищеварению с ними тяжело.",
    yellow: () => "Продукты на тарелке сочетаются не лучшим образом — после еды остаётся лёгкая тяжесть.",
    green: () => "Продукты на тарелке хорошо сочетаются — пищеварению с ними легко.",
  },
  {
    key: "fiber", name: "Клетчатка",
    red: c => c.variant === "B"
      ? "Сырых овощей очень много за раз — кишечнику это даётся тяжело, отсюда вздутие."
      : "Клетчатки на тарелке нет, а без неё стулу не из чего формироваться и желчь густеет — отсюда запоры и вздутие после жирного.",
    yellow: c => {
      if (c.variant === "A" && slot(c.items)) return `${cap(slot(c.items))} — это в основном вода, клетчатки в ${v(c.pl, "нём", "них")} почти нет, а без неё стулу не из чего формироваться — отсюда запоры.`;
      const g = slot(c.items_gen);
      if (g) return `Клетчатка есть, но её мало: ${g} не хватит, чтобы стул формировался как нужно, — отсюда запоры.`;
      return "Клетчатка есть, но её мало: стулу не из чего формироваться как нужно — отсюда запоры.";
    },
    green: c => slot(c.items)
      ? `${cap(slot(c.items))} ${v(c.pl, "даёт", "дают")} достаточно клетчатки — кишечнику есть с чем работать.`
      : "Клетчатки на тарелке достаточно — кишечнику есть с чем работать.",
  },
  {
    key: "satiety", name: "Сытность и баланс",
    red: c => {
      const pf = slot(c.protein_fat), f = slot(c.fast);
      if (c.variant === "B" && pf && f) return `${cap(pf)} хорошо ${v(c.pl, "насыщает", "насыщают")}, но ${f} быстро ${v(c.fast_pl, "поднимает и роняет", "поднимают и роняют")} уровень сахара в крови — через пару часов потянет на перекус и сладкое.`;
      return "Такая еда надолго не насытит: через пару часов сахар в крови упадёт и потянет на сладкое.";
    },
    yellow: c => {
      const p = slot(c.protein), cx = slot(c.complex), w = slot(c.weak);
      if (p && cx && w) return `${cap(p)} и ${cx} дают хорошую основу, но ${w} быстро ${v(c.weak_pl, "поднимает и роняет", "поднимают и роняют")} уровень сахара в крови — через пару часов потянет на сладкое.`;
      return "Основа для сытости есть, но одного из компонентов не хватает — через пару часов потянет на перекус.";
    },
    green: c => {
      const p = slot(c.protein), f = slot(c.fat), cx = slot(c.complex);
      if (p && f && cx) return `${cap(p)}, ${f} и ${cx} — всё на месте, такой еды хватит до следующего приёма.`;
      return "Белок, жир и сложные углеводы — всё на месте, такой еды хватит до следующего приёма.";
    },
  },
  {
    key: "drink", name: "Напиток к еде",
    red: c => {
      const d = slot(c.drink, "напиток");
      if (c.variant === "C") return `${cap(d)} сразу после еды ${v(c.pl, "мешает", "мешают")} усвоению железа и ${v(c.pl, "разбавляет", "разбавляют")} желудочный сок — появляется тяжесть.`;
      const base = `${cap(d)} за едой ${v(c.pl, "растягивает", "растягивают")} желудок и ${v(c.pl, "разбавляет", "разбавляют")} желудочный сок — пищеварение замедляется, появляется тяжесть`;
      return c.variant === "B" ? base + ", и к тому же это сахар в жидком виде." : base + ".";
    },
    yellow: c => (c.variant === "B" || !slot(c.drink))
      ? "Про напиток вы не написали: любая жидкость за едой разбавляет желудочный сок, и пищеварение замедляется."
      : `${cap(slot(c.drink))} немного ${v(c.pl, "разбавляет", "разбавляют")} желудочный сок — пищеварение идёт медленнее.`,
    green: () => "Без питья за едой желудочный сок работает в полную силу — это хорошо.",
  },
  {
    key: "processing", name: "Переработка",
    red: c => `${cap(slot(c.items, "покупные продукты"))} — фабричная еда: клетчатки в ней мало, а добавки вредят кишечной микрофлоре — отсюда вздутие и нестабильный стул.`,
    yellow: c => `${cap(slot(c.items, "один из продуктов"))} — фабричный продукт, и добавки в ${v(c.pl, "нём", "них")} вредят кишечной микрофлоре — отсюда нестабильный стул.`,
    green: () => "Всё на тарелке — цельные продукты, приготовленные дома, добавок здесь нет.",
  },
  {
    key: "order", name: "Порядок еды",
    red: c => { const s = slot(c.start_gen, "гарнира"); return `Вы начинаете ${so(s)} ${s} — так пищеварение включается с опозданием: желудочный сок и желчь не успевают, и еда долго лежит тяжестью.`; },
    yellow: c => {
      const s = slot(c.start_gen);
      if (c.variant === "B" || !s) return "С чего вы начинаете есть, вы не написали; если с хлеба, гарнира, сладкого или выпечки — пищеварение включается с опозданием, и еда долго лежит тяжестью.";
      return `Старт ${so(s)} ${s} немного откладывает выработку желудочного сока и желчи — пищеварение включается медленнее.`;
    },
    green: c => { const s = slot(c.start_gen, "белка"); return `Вы начинаете ${so(s)} ${s} — так желудочный сок и желчь включаются вовремя.`; },
  },
];

export function compose(j) {
  if (!j || j.plate === false) return NO_PLATE;

  const lines = [];
  lines.push(HEADER);
  lines.push("");
  lines.push("🍽 " + cap(slot(j.dish, "Ваша тарелка").replace(/\s*,\s*$/, "")) + ".");
  lines.push("");
  const sum = summaryParagraph(j.summary);
  lines.push(sum.text);
  lines.push("");

  let reds = 0;
  for (const item of BANK) {
    const c = (j.criteria && j.criteria[item.key]) || {};
    const st = norm(c.status);
    if (st === "red") reds++;
    let text;
    try { text = item[st](c); } catch { text = item[st]({}); }
    lines.push(`${ST[st]} ${item.name} — ${text}`);
  }

  lines.push("");
  const dish = slot(j.cta_dish);
  const sy = sum.symptoms.length ? sum.symptoms : (reds ? ["heartburn", "bloating"] : []);
  if (sy.length || reds) {
    const lead = dish
      ? `Если вы любите ${dish}, отказываться от этого блюда не обязательно — важно правильно собрать его состав.`
      : "Отказываться от любимых блюд не обязательно — важно правильно собрать их состав.";
    lines.push(`${lead} Как это сделать, чтобы после еды не было ${joinList(sy.slice(0, 2).map(x => SYMPT_GEN[x]))}, — без голода и жёстких диет — расскажем на бесплатном вебинаре: ${LINK}`);
  } else {
    lines.push(`Эта тарелка собрана хорошо. Как так же собрать весь рацион — расскажем на бесплатном вебинаре: ${LINK}`);
  }

  const sp = j.special;
  if (sp && typeof sp === "object") {
    let t = null;
    if (sp.kind === "child") t = "Для детей рацион подбирается индивидуально с врачом — этот разбор его не заменяет.";
    else if (sp.kind === "pregnancy") t = "При беременности рацион подбирается индивидуально с врачом — этот разбор его не заменяет.";
    else if (sp.kind === "diagnosis") t = `При ${slot(sp.label_prep, "заболеваниях ЖКТ")} рацион подбирается индивидуально с врачом — этот разбор его не заменяет.`;
    if (t) { lines.push(""); lines.push(t); }
  }

  lines.push("");
  lines.push(DISCLAIMER);
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
