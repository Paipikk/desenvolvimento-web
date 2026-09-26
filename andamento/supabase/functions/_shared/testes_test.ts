import { assert, assertEquals } from "jsr:@std/assert@1";
import { calcularDigitoVerificador, formatarCnj, mascararCnj, validarCnj } from "./cnj.ts";
import { aliasDatajud, tribunalPeloNumero } from "./tribunais.ts";
import { classificarPorRegra } from "./relevancia.ts";
import { hashMovimento, normalizarDataHora } from "./datajud.ts";

Deno.test("CNJ: número de exemplo da documentação do Datajud é válido", () => {
  const r = validarCnj("00008323520184013202");
  assert(r.valido);
  assertEquals(formatarCnj("00008323520184013202"), "0000832-35.2018.4.01.3202");
  assert(validarCnj("0000832-35.2018.4.01.3202").valido);
});

Deno.test("CNJ: dígito verificador errado é rejeitado", () => {
  const r = validarCnj("0000832-36.2018.4.01.3202");
  assert(!r.valido);
});

Deno.test("CNJ: formato e tamanho", () => {
  assert(!validarCnj("123").valido);
  assert(!validarCnj("0000832-35.2018.4.01.320").valido);
  assert(!validarCnj("0000832/35.2018.4.01.3202").valido);
  assert(!validarCnj("").valido);
});

Deno.test("CNJ: cálculo do DV gera números válidos", () => {
  const dv = calcularDigitoVerificador("5001234", "2023", "8", "21", "0001");
  assert(validarCnj(`5001234-${dv}.2023.8.21.0001`).valido);
});

Deno.test("CNJ: máscara progressiva", () => {
  assertEquals(mascararCnj("50012345"), "5001234-5");
  assertEquals(mascararCnj("00008323520184013202"), "0000832-35.2018.4.01.3202");
});

Deno.test("Tribunal pelo número e alias", () => {
  assertEquals(tribunalPeloNumero("00008323520184013202"), "TRF1");
  assertEquals(tribunalPeloNumero("50012340020238210001"), "TJRS");
  assertEquals(tribunalPeloNumero("00012340020235040001"), "TRT4");
  assertEquals(tribunalPeloNumero("00012340020238070001"), "TJDFT");
  assertEquals(aliasDatajud("TJRS"), "api_publica_tjrs");
  assertEquals(aliasDatajud("trt4"), "api_publica_trt4");
  assertEquals(aliasDatajud("TRE-SP"), "api_publica_tre-sp");
  assertEquals(aliasDatajud("TJDF"), "api_publica_tjdft");
  assertEquals(aliasDatajud("XYZ"), null);
});

Deno.test("Relevância: burocráticas x importantes", () => {
  assertEquals(classificarPorRegra("Conclusos para julgamento", null, 51), "baixa");
  assertEquals(classificarPorRegra("Juntada de Petição", "tipo de petição: Recurso", 85), "baixa");
  assertEquals(classificarPorRegra("Expedição de Certidão", null, 60), "baixa");
  assertEquals(classificarPorRegra("Julgado procedente o pedido", null, 219), "alta");
  assertEquals(classificarPorRegra("Audiência de conciliação designada", null, 970), "alta");
  assertEquals(classificarPorRegra("Expedição de alvará", null, 60), "alta");
  assertEquals(classificarPorRegra("Algo novo", null, null), "indefinida");
});

Deno.test("Datajud: normalização de datas", () => {
  assertEquals(normalizarDataHora("2023-05-10T14:32:11.000Z"), "2023-05-10T14:32:11.000Z");
  assertEquals(normalizarDataHora("20230510143211"), "2023-05-10T17:32:11.000Z");
  assertEquals(normalizarDataHora("2023-05-10T14:32:11"), "2023-05-10T17:32:11.000Z");
  assertEquals(normalizarDataHora("lixo"), null);
});

Deno.test("Datajud: hash estável", async () => {
  const m = { codigo: 51, nome: "Conclusão", dataHora: "2023-05-10T14:32:11.000Z", complemento: null };
  assertEquals(await hashMovimento(m), await hashMovimento({ ...m }));
  assert((await hashMovimento(m)) !== (await hashMovimento({ ...m, codigo: 52 })));
});

import { montarHtml } from "./email.ts";

Deno.test("E-mail: HTML escapa o texto e mantém quebras de linha", () => {
  const html = montarHtml("Olá <b>Maria</b> & cia\n\nEscritório");
  assert(html.includes("Olá &lt;b&gt;Maria&lt;/b&gt; &amp; cia<br><br>Escritório"));
  assert(!html.includes("<b>Maria"));
});
