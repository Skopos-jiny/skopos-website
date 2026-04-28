import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = path.resolve("outputs", "estimate_revision");
const outputPath = path.join(outputDir, "견적서_35평_350만원_수정안.xlsx");

const lineItems = [
  ["PTC 난방필름", "35평", "식", 1, 1850000, 1850000],
  ["5미리 열반사 단열재", "", "식", 1, 700000, 700000],
  ["필름보강재", "", "식", 1, 740000, 740000],
  ["온도조절기", "", "EA", 7, 30000, 210000],
];

const total = lineItems.reduce((sum, row) => sum + row[5], 0);

const workbook = Workbook.create();
const sheet = workbook.worksheets.add("견적서");
sheet.showGridLines = false;

sheet.getRange("A1:H1").merge();
sheet.getRange("A1").values = [["견  적  서"]];
sheet.getRange("A1").format = {
  font: { bold: true, color: "#000000" },
};
sheet.getRange("A1").format.horizontalAlignment = "center";

sheet.getRange("A3:B3").values = [["일자 :", "2026 년   4 월   25 일"]];
sheet.getRange("A5:B5").values = [["귀하", ""]];
sheet.getRange("A7:B7").values = [["아래와 같이 견적합니다.", ""]];

sheet.getRange("D3:H7").values = [
  ["사업자번호", "114-15-76180", "", "", ""],
  ["상호", "한국썬난방", "대표자", "최종민", ""],
  ["소재지", "수원시 팔달구 인계로166번길 47-17", "", "", ""],
  ["업태", "건설업", "종목", "전기난방필름", ""],
  ["담당자", "최종민", "전화번호", "1544-1857", ""],
];

sheet.getRange("A9:C9").merge();
sheet.getRange("D9:H9").merge();
sheet.getRange("A9:D12").values = [
  ["합계금액", null, null, "일금 삼백오십만원정  ( 3,500,000 원 )"],
  ["건명", null, null, "전기난방필름 시공"],
  ["부가사항", null, null, "부가세 별도."],
  ["명칭 및 유형", "규격", "단위", "수량"],
];
sheet.getRange("E12:H12").values = [["단가", null, "금액", null]];
sheet.getRange("E12:F12").merge();
sheet.getRange("G12:H12").merge();

for (let r = 13; r <= 20; r += 1) {
  sheet.getRange(`A${r}:A${r}`).merge();
  sheet.getRange(`E${r}:F${r}`).merge();
  sheet.getRange(`G${r}:H${r}`).merge();
}

sheet.getRange("A13:H16").values = lineItems.map((item) => [
  item[0],
  item[1],
  item[2],
  item[3],
  item[4],
  null,
  item[5],
  null,
]);

sheet.getRange("A21:C21").merge();
sheet.getRange("G21:H21").merge();
sheet.getRange("A21:H21").values = [["합계", null, null, null, null, null, total, null]];

sheet.getRange("A22:C24").merge();
sheet.getRange("D22:H24").merge();
sheet.getRange("A22").values = [["비고"]];
sheet.getRange("D22").values = [["* 시공면적 : 35평\n* 시공현장 : 단원구 성곡동 지원로7"]];

sheet.getRange("A25:H25").merge();
sheet.getRange("A25").values = [["공사범위 및 협조사항"]];
sheet.getRange("A26:D26").merge();
sheet.getRange("E26:H26").merge();
sheet.getRange("A26:E26").values = [["공사범위", null, null, null, "협조사항"]];
sheet.getRange("A27:D27").merge();
sheet.getRange("E27:H27").merge();

sheet.getRange("A28:H30").merge();
sheet.getRange("A28").values = [[
  "1. 본 견적서에 관한 사항은 대표번호 1544-1857 또는 핸드폰 010-3758-6090으로\n   문의하여 주십시오.\n2. 상기 견적은 유효기간 내 유효합니다.",
]];

sheet.getRange("A9:H30").format.wrapText = true;
sheet.getRange("D3:H7").format.borders = { preset: "all", style: "thin", color: "#000000" };
sheet.getRange("A9:H30").format.borders = { preset: "all", style: "thin", color: "#000000" };
sheet.getRange("A1:H30").format.font = { name: "Malgun Gothic", size: 11, color: "#000000" };
sheet.getRange("A12:H12").format = {
  fill: "#D8FFD8",
  font: { bold: true, color: "#000000" },
  borders: { preset: "all", style: "thin", color: "#000000" },
};
sheet.getRange("D9").format = {
  font: { bold: true, color: "#9C1C1C" },
};
sheet.getRange("A21:H21").format = {
  font: { bold: true, color: "#000000" },
};

sheet.getRange("A1:H30").format.verticalAlignment = "center";
sheet.getRange("A1:H30").format.horizontalAlignment = "center";
sheet.getRange("D9:H11").format.horizontalAlignment = "left";
sheet.getRange("D22:H24").format.horizontalAlignment = "left";
sheet.getRange("A28:H30").format.horizontalAlignment = "left";

sheet.getRange("E13:H21").format.numberFormat = "#,##0";
sheet.getRange("A:A").format.columnWidthPx = 165;
sheet.getRange("B:B").format.columnWidthPx = 70;
sheet.getRange("C:C").format.columnWidthPx = 70;
sheet.getRange("D:D").format.columnWidthPx = 70;
sheet.getRange("E:F").format.columnWidthPx = 95;
sheet.getRange("G:H").format.columnWidthPx = 95;
sheet.getRange("1:1").format.rowHeightPx = 54;
sheet.getRange("9:30").format.rowHeightPx = 34;
sheet.getRange("22:24").format.rowHeightPx = 42;
sheet.getRange("28:30").format.rowHeightPx = 36;

await fs.mkdir(outputDir, { recursive: true });

const preview = await workbook.render({
  sheetName: "견적서",
  range: "A1:H30",
  scale: 1,
  format: "png",
});
await fs.writeFile(path.join(outputDir, "estimate_preview.png"), new Uint8Array(await preview.arrayBuffer()));

const exported = await SpreadsheetFile.exportXlsx(workbook);
await exported.save(outputPath);

console.log(outputPath);
