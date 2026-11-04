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

// ---------- короткий формат ответа ----------
// 1) Что это за блюдо и что в нём по составу. 2) Что мешает. 3) Что хорошо. 4) Вопросы к вебинару.
const SYMPT_ORDER = ["heartburn", "bloating", "belching", "heaviness", "mucus"];
const SYMPT_ACC = { heartburn: "изжогу", bloating: "вздутие", belching: "отрыжку", heaviness: "тяжесть после еды", mucus: "ощущение слизи в горле" };
const SYMPT_GEN = { heartburn: "изжоги", bloating: "вздутия", belching: "отрыжки", heaviness: "тяжести", mucus: "слизи в горле" };

function aboutDish(sm) {
  sm = sm || {};
  const name = slot(sm.name);
  const plus = [];
  if (sm.protein_ok === true) plus.push("белок");
  if (sm.fiber === "enough") plus.push("клетчатка");
  const many = [];
  if (sm.fast_carbs === "many") many.push("простых углеводов");
  if (sm.fat_high === true) many.push("жира");
  const little = [];
  if (sm.protein_ok === false) little.push("белка");
  if (sm.fiber === "little" || sm.fiber === "none") little.push("клетчатки");
  const minus = [];
  if (many.length) minus.push("много " + joinList(many));
  if (little.length) minus.push("мало " + joinList(little));
  if (sm.fast_carbs === "some") minus.push(plus.length ? "есть и простые углеводы" : "есть простые углеводы");

  let comp = "";
  if (plus.length && minus.length) comp = `есть ${joinList(plus)}, но ${minus.join(", ")}`;
  else if (plus.length) comp = `есть ${joinList(plus)}, состав сбалансирован`;
  else if (minus.length) comp = minus.join(", ");

  let first;
  if (sm.role === "dessert" || sm.role === "snack") {
    const what = sm.role === "dessert" ? "десерт" : "перекус";
    first = `${name ? cap(name) : "Такое блюдо"} — это скорее ${what}, чем полноценный приём пищи${comp ? ": " + comp : ""}.`;
  } else {
    first = `${name ? cap(name) : "Это"} — полноценный приём пищи${comp ? ": " + comp : ""}.`;
  }

  const sy = SYMPT_ORDER.filter(x => Array.isArray(sm.symptoms) && sm.symptoms.includes(x));
  let second;
  if (sy.length) {
    const lead = sm.inflammatory === "many" ? "Многие ингредиенты здесь поддерживают воспаление слизистой, поэтому при заболеваниях ЖКТ" : "При заболеваниях ЖКТ";
    second = `${lead} такое блюдо с большой долей вероятности вызовет ${joinList(sy.map(x => SYMPT_ACC[x]))}${sm.evening === true ? " — особенно вечером" : ""}.`;
  } else {
    second = "Изжоги, вздутия и тяжести от такого блюда ждать не стоит.";
  }
  return { text: first + " " + second, symptoms: sy, minus: minus.length > 0, evening: sm.evening === true };
}

// Короткие строки «что мешает» (по статусу и варианту) и «что хорошо».
function problemLine(key, c) {
  const st = norm(c.status);
  if (key === "compat") {
    if (st === "red" && c.variant === "B") return "сладкое вместо еды — через пару часов снова захочется есть";
    if (st === "red" && c.variant === "C") return "сладкое вместе с едой — после еды тяжесть";
    if (st === "red") return "белок и крахмалистые продукты в одной тарелке — после еды тяжесть";
    if (st === "yellow") return "крахмалистые продукты рядом с белком — после еды лёгкая тяжесть";
  }
  if (key === "satiety") {
    if (st === "red" && c.variant !== "B") return "надолго не насытит — потянет на перекус и сладкое";
    if ((st === "red" && c.variant === "B") || (st === "yellow" && c.variant !== "B")) return "быстрые углеводы — через пару часов потянет на сладкое";
    if (st === "yellow") return "одного из компонентов маловато — скоро захочется перекусить";
  }
  if (key === "drink") {
    const d = slot(c.drink);
    if (st === "red" && c.variant === "C") return `${d ? d : "кофе"} сразу после еды — тяжесть`;
    if (st === "red" && c.variant === "B") return `${d ? d : "сладкий напиток"} к еде — лишний сахар и тяжесть`;
    if (st === "red") return `${d ? d : "напиток"} за едой — пищеварение замедляется`;
    if (st === "yellow" && c.variant !== "B") return "жидкость за едой — пищеварение идёт медленнее";
  }
  if (key === "processing") {
    const it = slot(c.items);
    if (st === "red" || st === "yellow") return `${it ? it : "покупные продукты"} — фабричная еда, добавки вредят кишечной микрофлоре`;
  }
  return null;
}
const GOOD = {
  compat: "продукты хорошо сочетаются",
  satiety: "такой еды хватит до следующего приёма",
  drink: "за едой вы не пили",
  processing: "всё из цельных продуктов",
};
const KEYS = ["compat", "satiety", "drink", "processing"];

export function compose(j) {
  if (!j || j.plate === false) return NO_PLATE;
  const cr = j.criteria || {};
  const sm = j.summary || {};

  const lines = [HEADER, "", "🍽 " + cap(slot(j.dish, "Ваша тарелка").replace(/\s*,\s*$/, "")) + ".", ""];
  const about = aboutDish(sm);
  lines.push(about.text);

  // что мешает: сначала красное, потом жёлтое
  const bad = [];
  for (const want of ["red", "yellow"]) {
    for (const k of KEYS) {
      const c = cr[k] || {};
      if (norm(c.status) !== want) continue;
      const t = problemLine(k, c);
      if (t) bad.push(`${ST[want]} ${cap(t)}`);
    }
    if (want === "red" && sm.oil_unknown === true) bad.push("🟡 Непонятно, на каком масле жарили — обычное растительное масло при жарке поддерживает воспаление");
  }
  if (bad.length) {
    lines.push("", "Что мешает:");
    bad.slice(0, 4).forEach(t => lines.push(t));
  }
  const good = KEYS.filter(k => norm((cr[k] || {}).status) === "green").map(k => GOOD[k]);
  if (good.length) { lines.push(""); lines.push("Что хорошо: " + joinList(good) + "."); }

  // вопросы к вебинару
  const Q = [];
  const dish = slot(j.cta_dish);
  const symGen = joinList(about.symptoms.slice(0, 2).map(x => SYMPT_GEN[x]));
  if (about.minus && about.symptoms.length) Q.push(`как собрать ${dish || "это блюдо"} так, чтобы после еды не было ${symGen}`);
  else if (about.minus) Q.push(`как собрать ${dish || "это блюдо"} так, чтобы оно было сбалансированным`);
  else if (about.symptoms.length) Q.push(`почему даже сбалансированное блюдо даёт ${joinList(about.symptoms.slice(0, 2).map(x => SYMPT_ACC[x]))} и как это убрать`);
  const sat = cr.satiety || {}, sst = norm(sat.status);
  if ((sst === "yellow" && sat.variant !== "B") || (sst === "red" && sat.variant === "B")) Q.push("чем заменить быстрые углеводы, чтобы не тянуло на сладкое");
  else if (sst === "yellow" || sst === "red") Q.push("чего не хватает этой тарелке, чтобы сытости хватало до следующей еды");
  if (about.evening) Q.push("в какое время такое блюдо лучше есть");
  const cm = cr.compat || {}, cst = norm(cm.status);
  if (cst === "red" && (cm.variant === "B" || cm.variant === "C")) Q.push("когда и как можно есть сладкое без тяжести");
  else if (cst === "red" || cst === "yellow") Q.push("какие продукты сочетаются в одной тарелке, а какие нет");
  const dr = cr.drink || {}, dst = norm(dr.status);
  if (dst === "red" || (dst === "yellow" && dr.variant !== "B")) Q.push("что и когда пить, чтобы не мешать пищеварению");
  const pr = cr.processing || {}, pst = norm(pr.status);
  if (pst === "red" || pst === "yellow") Q.push("чем заменить фабричные продукты");

  lines.push("");
  if (Q.length) {
    lines.push("Подробно — на бесплатном вебинаре Ольги Валерьевны. Разберём:");
    const qs = Q.slice(0, 3);
    qs.forEach((q, i) => lines.push("— " + q + (i === qs.length - 1 ? "." : ";")));
    lines.push("", `Регистрация: ${LINK}`);
  } else {
    lines.push(`Эта тарелка собрана хорошо. Как так же собрать весь рацион — расскажем на бесплатном вебинаре: ${LINK}`);
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
