const encoder=new TextEncoder();
const xml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'');
const columnName=index=>{let value=index+1,result='';while(value){value--;result=String.fromCharCode(65+value%26)+result;value=Math.floor(value/26)}return result};
const excelDate=value=>{const match=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})/);if(!match)return null;return Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3]))/86400000+25569};
const safeSheetName=(value,index,used)=>{const base=String(value||`Лист ${index+1}`).replace(/[\\/?*\[\]:]/g,' ').trim().slice(0,31)||`Лист ${index+1}`;let name=base,suffix=2;while(used.has(name))name=`${base.slice(0,27)} ${suffix++}`;used.add(name);return name};
const cell=(ref,value,type)=>{
  if(value===null||value===undefined||value==='')return `<c r="${ref}"/>`;
  if(type==='money'&&Number.isFinite(Number(value)))return `<c r="${ref}" s="3"><v>${Number(value)/100}</v></c>`;
  if(type==='date'){const serial=excelDate(value);if(serial!==null)return `<c r="${ref}" s="4"><v>${serial}</v></c>`;}
  if(type==='number'&&Number.isFinite(Number(value)))return `<c r="${ref}" s="5"><v>${Number(value)}</v></c>`;
  const text=Array.isArray(value)?value.filter(Boolean).join(', '):typeof value==='boolean'?(value?'Да':'Нет'):typeof value==='object'?value.name||value.label||value.title||JSON.stringify(value):String(value);
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
};

const worksheet=(sheet)=>{
  const columns=sheet.columns||[],rows=sheet.rows||[],last=columnName(Math.max(0,columns.length-1)),lastRow=Math.max(2,rows.length+2);
  const widths=columns.map((column,index)=>`<col min="${index+1}" max="${index+1}" width="${Math.max(10,Math.min(42,Number(column.width)||Math.max(12,String(column.label||'').length+3)))}" customWidth="1"/>`).join('');
  const header=columns.map((column,index)=>`<c r="${columnName(index)}2" s="1" t="inlineStr"><is><t>${xml(column.label||column.key||'')}</t></is></c>`).join('');
  const body=rows.map((row,rowIndex)=>`<row r="${rowIndex+3}" ht="19" customHeight="1">${columns.map((column,columnIndex)=>cell(`${columnName(columnIndex)}${rowIndex+3}`,Array.isArray(row)?row[columnIndex]:row?.[column.key],column.type)).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${last}${lastRow}"/><sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${widths}</cols><sheetData><row r="1" ht="26" customHeight="1"><c r="A1" s="2" t="inlineStr"><is><t>${xml(sheet.title||sheet.name)}</t></is></c></row><row r="2" ht="24" customHeight="1">${header}</row>${body}</sheetData>${columns.length>1?`<mergeCells count="1"><mergeCell ref="A1:${last}1"/></mergeCells>`:''}<autoFilter ref="A2:${last}${lastRow}"/><pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
};

const crcTable=()=>{const table=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0}return table};
const CRC=crcTable();
const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes)crc=CRC[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0};
const u16=value=>new Uint8Array([value&255,value>>>8&255]);
const u32=value=>new Uint8Array([value&255,value>>>8&255,value>>>16&255,value>>>24&255]);
const concat=parts=>{const size=parts.reduce((sum,part)=>sum+part.length,0),result=new Uint8Array(size);let offset=0;for(const part of parts){result.set(part,offset);offset+=part.length}return result};
const zip=files=>{const local=[],central=[];let offset=0;for(const file of files){const name=encoder.encode(file.name),data=typeof file.data==='string'?encoder.encode(file.data):file.data,crc=crc32(data),header=concat([u32(0x04034b50),u16(20),u16(0x0800),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),name]),record=concat([header,data]);local.push(record);central.push(concat([u32(0x02014b50),u16(20),u16(20),u16(0x0800),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),name]));offset+=record.length}const directory=concat(central),end=concat([u32(0x06054b50),u16(0),u16(0),u16(files.length),u16(files.length),u32(directory.length),u32(offset),u16(0)]);return concat([...local,directory,end])};

const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="# ##0.00 ₽"/><numFmt numFmtId="165" formatCode="dd.mm.yyyy"/></numFmts><fonts count="3"><font><sz val="10"/><name val="Arial"/><color rgb="FF352D36"/></font><font><b/><sz val="10"/><name val="Arial"/><color rgb="FFFFFFFF"/></font><font><b/><sz val="14"/><name val="Arial"/><color rgb="FF352D36"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF7A4055"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFFFFFFF"/></left><right style="thin"><color rgb="FFFFFFFF"/></right><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

export function buildXlsx({sheets,creator='tie.event'}){
  if(!Array.isArray(sheets)||!sheets.length)throw new Error('Добавьте хотя бы один лист Excel.');
  const used=new Set(),prepared=sheets.map((sheet,index)=>({...sheet,name:safeSheetName(sheet.name,index,used)}));
  const overrides=prepared.map((_,index)=>`<Override PartName="/xl/worksheets/sheet${index+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  const workbookSheets=prepared.map((sheet,index)=>`<sheet name="${xml(sheet.name)}" sheetId="${index+1}" r:id="rId${index+1}"/>`).join('');
  const sheetRels=prepared.map((_,index)=>`<Relationship Id="rId${index+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index+1}.xml"/>`).join('');
  const created=new Date().toISOString();
  return zip([
    {name:'[Content_Types].xml',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${overrides}</Types>`},
    {name:'_rels/.rels',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`},
    {name:'docProps/core.xml',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>${xml(creator)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created></cp:coreProperties>`},
    {name:'xl/workbook.xml',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${workbookSheets}</sheets><calcPr calcId="0" calcMode="auto"/></workbook>`},
    {name:'xl/_rels/workbook.xml.rels',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRels}<Relationship Id="rId${prepared.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`},
    {name:'xl/styles.xml',data:styles},
    ...prepared.map((sheet,index)=>({name:`xl/worksheets/sheet${index+1}.xml`,data:worksheet(sheet)}))
  ]);
}

export function downloadXlsx(workbook,fileName){
  const name=(String(fileName||'tie-export').replace(/[\\/:*?"<>|]+/g,'-').replace(/\s+/g,' ').trim()||'tie-export').replace(/\.xlsx$/i,'')+'.xlsx';
  const blob=new Blob([buildXlsx(workbook)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  return name;
}
