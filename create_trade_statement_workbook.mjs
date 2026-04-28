import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = path.resolve("outputs", "trade_statement_extract");
const outputPath = path.join(outputDir, "거래명세표_추출_내역.xlsx");

const rows = [
  {
    date: "2026-04-20",
    serial: "04200512",
    imageNo: "Image #1",
    sourceFile: "KakaoTalk_20260427_220201010_03.jpg",
    item: "SMC(내장용)450*450",
    spec: "(주문품)450*450",
    note: "10박스",
    qty: 320,
    unit: "SH",
    unitPrice: 3260,
    supply: 1043200,
    checkNote: "",
  },
  {
    date: "2026-04-20",
    serial: "04200512",
    imageNo: "Image #1",
    sourceFile: "KakaoTalk_20260427_220201010_03.jpg",
    item: "운송비",
    spec: "",
    note: "",
    qty: 1,
    unit: "EA",
    unitPrice: 50000,
    supply: 50000,
    checkNote: "",
  },
  {
    date: "2026-04-20",
    serial: "04200512",
    imageNo: "Image #1",
    sourceFile: "KakaoTalk_20260427_220201010_03.jpg",
    item: "●크립바4M(우성)",
    spec: "4M(28*33*0.5T)",
    note: "",
    qty: 60,
    unit: "EA",
    unitPrice: 2640,
    supply: 158400,
    checkNote: "",
  },
  {
    date: "2026-04-20",
    serial: "04200512",
    imageNo: "Image #1",
    sourceFile: "KakaoTalk_20260427_220201010_03.jpg",
    item: "●(KS)개량찬넬19형4M",
    spec: "4M(38*12*1.2T)KS``",
    note: "",
    qty: 20,
    unit: "EA",
    unitPrice: 2720,
    supply: 54400,
    checkNote: "",
  },
  {
    date: "2026-04-20",
    serial: "04200512",
    imageNo: "Image #1",
    sourceFile: "KakaoTalk_20260427_220201010_03.jpg",
    item: "●AL-SMC용 ㄷ-몰딩(아이보리)★00",
    spec: "□3M(15+30+1T)``",
    note: "",
    qty: 22,
    unit: "EA",
    unitPrice: 3360,
    supply: 73920,
    checkNote: "품목명 후미 표기 육안 판독",
  },
  {
    date: "2026-04-20",
    serial: "04200512",
    imageNo: "Image #1",
    sourceFile: "KakaoTalk_20260427_220201010_03.jpg",
    item: "●와이어크립(크림바용)",
    spec: "크림바 와이어크립",
    note: "",
    qty: 1500,
    unit: "EA",
    unitPrice: 40,
    supply: 60000,
    checkNote: "",
  },
  {
    date: "2026-04-20",
    serial: "04200512",
    imageNo: "Image #1",
    sourceFile: "KakaoTalk_20260427_220201010_03.jpg",
    item: "●크림바죠인트(죠인) 대",
    spec: "크림바 죠인",
    note: "",
    qty: 50,
    unit: "EA",
    unitPrice: 80,
    supply: 4000,
    checkNote: "",
  },
  {
    date: "2026-04-20",
    serial: "04200512",
    imageNo: "Image #1",
    sourceFile: "KakaoTalk_20260427_220201010_03.jpg",
    item: "●판스프링(대)",
    spec: "",
    note: "",
    qty: 200,
    unit: "EA",
    unitPrice: 110,
    supply: 22000,
    checkNote: "",
  },
  {
    date: "2026-04-20",
    serial: "04200512",
    imageNo: "Image #1",
    sourceFile: "KakaoTalk_20260427_220201010_03.jpg",
    item: "●신형무핀행가 150L",
    spec: "150무핀행가(H150) 신형1.6T",
    note: "",
    qty: 30,
    unit: "EA",
    unitPrice: 130,
    supply: 3900,
    checkNote: "",
  },
  {
    date: "2026-04-20",
    serial: "04200512",
    imageNo: "Image #1",
    sourceFile: "KakaoTalk_20260427_220201010_03.jpg",
    item: "운송비",
    spec: "",
    note: "1톤 오병오기사님",
    qty: 1,
    unit: "EA",
    unitPrice: 60000,
    supply: 60000,
    checkNote: "",
  },
  {
    date: "2026-04-20",
    serial: "04200113",
    imageNo: "Image #2",
    sourceFile: "KakaoTalk_20260427_220201010.jpg",
    item: "●런너65형(KS)",
    spec: "3M(67+40+0.8T)M-RUNNER",
    note: "",
    qty: 4,
    unit: "EA",
    unitPrice: 3540,
    supply: 14160,
    checkNote: "",
  },
  {
    date: "2026-04-20",
    serial: "04200113",
    imageNo: "Image #2",
    sourceFile: "KakaoTalk_20260427_220201010.jpg",
    item: "●AL피스못(나트로 도장)★선두",
    spec: "3M(9.5T/백색)DJ-10",
    note: "",
    qty: 12,
    unit: "본",
    unitPrice: 3750,
    supply: 45000,
    checkNote: "품목명 괄호 안 일부 판독 유의",
  },
  {
    date: "2026-04-20",
    serial: "04200113",
    imageNo: "Image #2",
    sourceFile: "KakaoTalk_20260427_220201010.jpg",
    item: "●몰딩(30평)갤럭시화이트",
    spec: "4-3번(30+9)갤럭시화이트",
    note: "",
    qty: 15,
    unit: "EA",
    unitPrice: 2200,
    supply: 33000,
    checkNote: "",
  },
  {
    date: "2026-04-20",
    serial: "04200113",
    imageNo: "Image #2",
    sourceFile: "KakaoTalk_20260427_220201010.jpg",
    item: "●몰딩(계단)갤럭시화이트",
    spec: "24-2번(25+15)갤럭시화이트",
    note: "",
    qty: 25,
    unit: "EA",
    unitPrice: 2800,
    supply: 70000,
    checkNote: "",
  },
  {
    date: "2026-04-20",
    serial: "04200113",
    imageNo: "Image #2",
    sourceFile: "KakaoTalk_20260427_220201010.jpg",
    item: "●(KS)엠바19형4M",
    spec: "4M(50+19(0.5))KS``",
    note: "",
    qty: 10,
    unit: "EA",
    unitPrice: 2040,
    supply: 20400,
    checkNote: "",
  },
  {
    date: "2026-04-20",
    serial: "04200343",
    imageNo: "Image #3",
    sourceFile: "KakaoTalk_20260427_220201010_01.jpg",
    item: "PVC몰딩(중)백색★중앙★",
    spec: "마이너스몰딩(35*15*2400)",
    note: "",
    qty: 22,
    unit: "EA",
    unitPrice: 2000,
    supply: 44000,
    checkNote: "상세규격 괄호 닫힘 보정",
  },
  {
    date: "2026-04-20",
    serial: "04200343",
    imageNo: "Image #3",
    sourceFile: "KakaoTalk_20260427_220201010_01.jpg",
    item: "●몰딩(계단)갤럭시화이트",
    spec: "24-2번(25+15)갤럭시화이트",
    note: "",
    qty: 10,
    unit: "EA",
    unitPrice: 2800,
    supply: 28000,
    checkNote: "",
  },
  {
    date: "2026-04-18",
    serial: "04180107",
    imageNo: "Image #4",
    sourceFile: "KakaoTalk_20260427_220201010_02.jpg",
    item: "A급 소송 다루끼(건조)12개",
    spec: "12*1.0+1.0(27+27+3600)상급",
    note: "",
    qty: 3,
    unit: "단",
    unitPrice: 32400,
    supply: 97200,
    checkNote: "",
  },
  {
    date: "2026-04-18",
    serial: "04180107",
    imageNo: "Image #4",
    sourceFile: "KakaoTalk_20260427_220201010_02.jpg",
    item: "강질 합판투바이(LVL)6개",
    spec: "12*2.3+1.0(67+27+3600) / 중목 내림상 / E1 추가",
    note: "",
    qty: 1,
    unit: "단",
    unitPrice: 26500,
    supply: 26500,
    checkNote: "상세규격 중간 문구 육안 판독 유의",
  },
  {
    date: "2026-04-18",
    serial: "04180107",
    imageNo: "Image #4",
    sourceFile: "KakaoTalk_20260427_220201010_02.jpg",
    item: "운송비",
    spec: "",
    note: "락보 공정환 기사님",
    qty: 1,
    unit: "EA",
    unitPrice: 45000,
    supply: 45000,
    checkNote: "",
  },
];

const summaries = [
  {
    date: "2026-04-20",
    serial: "04200512",
    imageNo: "Image #1",
    sourceFile: "KakaoTalk_20260427_220201010_03.jpg",
    customer: "㈜이경림판장님.(★외수종)(진인터리어/010-3110-7921)",
    supplier: "주식회사 에스와이보드",
    totalAmount: 1682802,
    supplyTotal: 1529820,
    vat: 152982,
    deposit: 0,
    previousBalance: 17909925,
    receivableTotal: 19592727,
    memo: "SW%%(성용+학익)4/20(월)바로출고. 안산시 단원구 성곡동 725-1(대일개발현장), 010-3110-7921 / 1직출",
  },
  {
    date: "2026-04-20",
    serial: "04200113",
    imageNo: "Image #2",
    sourceFile: "KakaoTalk_20260427_220201010.jpg",
    customer: "㈜이경림판장님.(★외수종)(진인터리어/010-3110-7921)",
    supplier: "주식회사 에스와이보드",
    totalAmount: 200816,
    supplyTotal: 182560,
    vat: 18256,
    deposit: 0,
    previousBalance: 17709109,
    receivableTotal: 17909925,
    memo: ">>>(자가출고)4/20(월)오전 *안산 성곡동",
  },
  {
    date: "2026-04-20",
    serial: "04200343",
    imageNo: "Image #3",
    sourceFile: "KakaoTalk_20260427_220201010_01.jpg",
    customer: "㈜이경림판장님.(★외수종)(진인터리어/010-3110-7921)",
    supplier: "주식회사 에스와이보드",
    totalAmount: 79200,
    supplyTotal: 72000,
    vat: 7200,
    deposit: 0,
    previousBalance: 19592727,
    receivableTotal: 19671927,
    memo: ">>>(자가출고)4/20(월) *안산시 성곡동",
  },
  {
    date: "2026-04-18",
    serial: "04180107",
    imageNo: "Image #4",
    sourceFile: "KakaoTalk_20260427_220201010_02.jpg",
    customer: "㈜이경림판장님.(★외수종)(진인터리어/010-3110-7921)",
    supplier: "주식회사 에스와이보드",
    totalAmount: 185570,
    supplyTotal: 168700,
    vat: 16870,
    deposit: 0,
    previousBalance: 17523539,
    receivableTotal: 17709109,
    memo: "C%%(바로) 안산시 단원구 성곡동 725-1(대일개발현장), 010-3110-7921",
  },
];

const workbook = Workbook.create();
const details = workbook.worksheets.add("거래명세표 내역");
const summary = workbook.worksheets.add("문서별 요약");

details.showGridLines = false;
summary.showGridLines = false;

const detailHeaders = [
  "일자",
  "일련번호",
  "이미지",
  "원본파일",
  "품목명",
  "상세규격",
  "비고",
  "수량",
  "단위",
  "단가",
  "공급가액",
  "확인메모",
];

details.getRange("A1:L1").values = [detailHeaders];
details.getRangeByIndexes(1, 0, rows.length, detailHeaders.length).values = rows.map((r) => [
  r.date,
  r.serial,
  r.imageNo,
  r.sourceFile,
  r.item,
  r.spec,
  r.note,
  r.qty,
  r.unit,
  r.unitPrice,
  r.supply,
  r.checkNote,
]);

details.tables.add(`A1:L${rows.length + 1}`, true, "TradeStatementDetails");
details.freezePanes.freezeRows(1);
details.getRange("A1:L1").format = {
  fill: "#1F4E78",
  font: { bold: true, color: "#FFFFFF" },
};
details.getRange("A1:L1").format.horizontalAlignment = "center";
details.getRange(`A2:L${rows.length + 1}`).format.wrapText = true;
details.getRange(`B2:B${rows.length + 1}`).format.numberFormat = "00000000";
details.getRange(`H2:H${rows.length + 1}`).format.numberFormat = "#,##0";
details.getRange(`J2:K${rows.length + 1}`).format.numberFormat = "#,##0";
details.getRange("A:A").format.columnWidthPx = 95;
details.getRange("B:B").format.columnWidthPx = 90;
details.getRange("C:C").format.columnWidthPx = 80;
details.getRange("D:D").format.columnWidthPx = 315;
details.getRange("E:E").format.columnWidthPx = 210;
details.getRange("F:F").format.columnWidthPx = 275;
details.getRange("G:G").format.columnWidthPx = 160;
details.getRange("H:H").format.columnWidthPx = 65;
details.getRange("I:I").format.columnWidthPx = 55;
details.getRange("J:K").format.columnWidthPx = 95;
details.getRange("L:L").format.columnWidthPx = 190;

const summaryHeaders = [
  "일자",
  "일련번호",
  "이미지",
  "원본파일",
  "거래처",
  "공급자",
  "합계금액",
  "공급가액합계(표기)",
  "세액",
  "입금액",
  "전미수잔액",
  "총미수잔액",
  "품목공급가액합계(계산)",
  "차이",
  "하단메모",
];

summary.getRange("A1:O1").values = [summaryHeaders];
summary.getRangeByIndexes(1, 0, summaries.length, summaryHeaders.length).values = summaries.map((s) => [
  s.date,
  s.serial,
  s.imageNo,
  s.sourceFile,
  s.customer,
  s.supplier,
  s.totalAmount,
  s.supplyTotal,
  s.vat,
  s.deposit,
  s.previousBalance,
  s.receivableTotal,
  null,
  null,
  s.memo,
]);
summary.getRange("M2").formulas = [['=SUMIF(\'거래명세표 내역\'!$B$2:$B$200,B2,\'거래명세표 내역\'!$K$2:$K$200)']];
summary.getRange(`M2:M${summaries.length + 1}`).fillDown();
summary.getRange("N2").formulas = [["=M2-H2"]];
summary.getRange(`N2:N${summaries.length + 1}`).fillDown();
summary.tables.add(`A1:O${summaries.length + 1}`, true, "TradeStatementSummary");
summary.freezePanes.freezeRows(1);
summary.getRange("A1:O1").format = {
  fill: "#1F4E78",
  font: { bold: true, color: "#FFFFFF" },
};
summary.getRange("A1:O1").format.horizontalAlignment = "center";
summary.getRange(`G2:N${summaries.length + 1}`).format.numberFormat = "#,##0";
summary.getRange(`B2:B${summaries.length + 1}`).format.numberFormat = "00000000";
summary.getRange(`A2:O${summaries.length + 1}`).format.wrapText = true;
summary.getRange("A:A").format.columnWidthPx = 95;
summary.getRange("B:B").format.columnWidthPx = 90;
summary.getRange("C:C").format.columnWidthPx = 80;
summary.getRange("D:D").format.columnWidthPx = 315;
summary.getRange("E:E").format.columnWidthPx = 350;
summary.getRange("F:F").format.columnWidthPx = 180;
summary.getRange("G:N").format.columnWidthPx = 115;
summary.getRange("O:O").format.columnWidthPx = 460;

await fs.mkdir(outputDir, { recursive: true });

const detailPreview = await workbook.render({
  sheetName: "거래명세표 내역",
  range: `A1:L${rows.length + 1}`,
  scale: 1,
  format: "png",
});
await fs.writeFile(path.join(outputDir, "detail_preview.png"), new Uint8Array(await detailPreview.arrayBuffer()));

const summaryPreview = await workbook.render({
  sheetName: "문서별 요약",
  range: `A1:O${summaries.length + 1}`,
  scale: 1,
  format: "png",
});
await fs.writeFile(path.join(outputDir, "summary_preview.png"), new Uint8Array(await summaryPreview.arrayBuffer()));

const exported = await SpreadsheetFile.exportXlsx(workbook);
await exported.save(outputPath);

console.log(outputPath);
