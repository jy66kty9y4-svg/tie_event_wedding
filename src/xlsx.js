import {budgetFormatSegments} from './budget-format.js';
const encoder=new TextEncoder();
const xml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'');
const columnName=index=>{let value=index+1,result='';while(value){value--;result=String.fromCharCode(65+value%26)+result;value=Math.floor(value/26)}return result};
const excelDate=value=>{const match=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})/);if(!match)return null;return Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3]))/86400000+25569};
const safeSheetName=(value,index,used)=>{const base=String(value||`Лист ${index+1}`).replace(/[\\/?*\[\]:]/g,' ').trim().slice(0,31)||`Лист ${index+1}`;let name=base,suffix=2;while(used.has(name))name=`${base.slice(0,27)} ${suffix++}`;used.add(name);return name};
function styleRegistry(){
  const fonts=[{fontSize:16},{bold:true,color:'#ffffff',fontSize:16},{bold:true,fontSize:22}],fills=[null,null,'#7a4055'],xfs=[{font:0,fill:0,num:0},{font:1,fill:2,num:0},{font:2,fill:0,num:0},{font:0,fill:0,num:164},{font:0,fill:0,num:165},{font:0,fill:0,num:166}];
  const index=(items,value)=>{const at=items.findIndex(item=>JSON.stringify(item)===JSON.stringify(value));if(at>=0)return at;items.push(value);return items.length-1};
  const fontXml=style=>`<font>${style.bold?'<b/>':''}${style.italic?'<i/>':''}<sz val="${(style.fontSize||16)*.75}"/><name val="Arial"/><color rgb="FF${(style.color||'#352d36').slice(1).toUpperCase()}"/></font>`;
  return {id:(type,style={})=>{const num=type==='money'?164:type==='date'?165:type==='time'?167:type==='number'?166:0;const font=index(fonts,{fontSize:style.fontSize||16,...(style.bold?{bold:true}:{}),...(style.italic?{italic:true}:{}),...(style.color?{color:style.color}:{})}),fill=style.highlight&&style.highlight!=='none'?index(fills,style.highlight):0;return index(xfs,{font,fill,num})},
    xml:()=>`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="4"><numFmt numFmtId="164" formatCode='#,##0.00 &quot;₽&quot;'/><numFmt numFmtId="165" formatCode="dd.mm.yyyy"/><numFmt numFmtId="166" formatCode="#,##0.##########"/><numFmt numFmtId="167" formatCode="hh:mm"/></numFmts><fonts count="${fonts.length}">${fonts.map(fontXml).join('')}</fonts><fills count="${fills.length}">${fills.map((color,i)=>i===0?'<fill><patternFill patternType="none"/></fill>':i===1?'<fill><patternFill patternType="gray125"/></fill>':`<fill><patternFill patternType="solid"><fgColor rgb="FF${color.slice(1).toUpperCase()}"/><bgColor indexed="64"/></patternFill></fill>`).join('')}</fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.map(style=>`<xf numFmtId="${style.num}" fontId="${style.font}" fillId="${style.fill}" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" wrapText="1"${style.num?' horizontal="right"':''}/></xf>`).join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`};
}
const runProperties=style=>`${style.bold?'<b/>':style.bold===false?'<b val="0"/>':''}${style.italic?'<i/>':style.italic===false?'<i val="0"/>':''}${style.fontSize?`<sz val="${style.fontSize*.75}"/>`:''}${style.color?`<color rgb="FF${style.color.slice(1).toUpperCase()}"/>`:''}`;
const cell=(ref,raw,type,styles)=>{
  const descriptor=raw?._sheetCell?raw:null,value=descriptor?descriptor.value:raw,format=descriptor?.format,typeName=descriptor?.type||type;
  const styleId=styles.id(typeName,{...format?.style,...(!format?.style?.highlight&&format?.ranges?.some(range=>range.style?.highlight&&range.style.highlight!=='none')?{highlight:format.ranges.find(range=>range.style?.highlight&&range.style.highlight!=='none').style.highlight}:{})});
  if(descriptor?.formula){const cached=value==null?'':typeName==='money'?Number(value)/100:Number(value);return `<c r="${ref}" s="${styleId}"${value==null?' t="str"':''}><f>${xml(descriptor.formula)}</f><v>${cached}</v></c>`;}
  if(value===null||value===undefined||value==='')return `<c r="${ref}" s="${styleId}"/>`;
  if(['money','number'].includes(typeName)&&Number.isFinite(Number(value)))return `<c r="${ref}" s="${styleId}"><v>${typeName==='money'?Number(value)/100:Number(value)}</v></c>`;
  if(typeName==='date'){const serial=excelDate(value);if(serial!==null)return `<c r="${ref}" s="${styleId}"><v>${serial}</v></c>`;}
  if(typeName==='time'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value)){const[hours,minutes]=value.split(':').map(Number);return `<c r="${ref}" s="${styleId}"><v>${(hours*60+minutes)/1440}</v></c>`;}
  const text=Array.isArray(value)?value.filter(Boolean).join(', '):typeof value==='boolean'?(value?'Да':'Нет'):typeof value==='object'?value.name||value.label||value.title||JSON.stringify(value):String(value);
  const rich=format?.ranges?.length?budgetFormatSegments(text,format).map(segment=>`<r><rPr>${runProperties({...format.style,...segment.style})}</rPr><t xml:space="preserve">${xml(segment.text)}</t></r>`).join(''):`<t xml:space="preserve">${xml(text)}</t>`;
  return `<c r="${ref}" s="${styleId}" t="inlineStr"><is>${rich}</is></c>`;
};
const worksheet=(sheet,styles)=>{
  const columns=sheet.columns||[],rows=sheet.rows||[],last=columnName(Math.max(0,columns.length-1)),lastRow=Math.max(2,rows.length+2);
  const widths=columns.map((column,index)=>`<col min="${index+1}" max="${index+1}" width="${Math.max(10,Math.min(115,Number(column.width)||Math.max(12,String(column.label||'').length+3)))}" customWidth="1"${column.hidden?' hidden="1"':''}/>`).join('');
  const header=columns.map((column,index)=>`<c r="${columnName(index)}2" s="1" t="inlineStr"><is><t>${xml(column.label||column.key||'')}</t></is></c>`).join('');
  const validations=columns.map((column,index)=>column.listName?`<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorTitle="Выберите вариант" error="Значение должно быть из списка" sqref="${columnName(index)}3:${columnName(index)}${Math.max(3,lastRow)}"><formula1>${column.listName}</formula1></dataValidation>`:'').filter(Boolean);
  const body=rows.map((row,rowIndex)=>`<row r="${rowIndex+3}" ht="${Math.max(24,(sheet.rowHeights?.[rowIndex]||44)*.75)}" customHeight="1">${columns.map((column,columnIndex)=>cell(`${columnName(columnIndex)}${rowIndex+3}`,Array.isArray(row)?row[columnIndex]:row?.[column.key],column.type,styles)).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${last}${lastRow}"/><sheetViews><sheetView showGridLines="1" workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="24"/><cols>${widths}</cols><sheetData><row r="1" ht="26" customHeight="1"><c r="A1" s="2" t="inlineStr"><is><t>${xml(sheet.title||sheet.name)}</t></is></c></row><row r="2" ht="24" customHeight="1">${header}</row>${body}</sheetData>${sheet.filter===false?'':`<autoFilter ref="A2:${last}${lastRow}"/>`}${columns.length>1?`<mergeCells count="1"><mergeCell ref="A1:${last}1"/></mergeCells>`:''}${validations.length?`<dataValidations count="${validations.length}">${validations.join('')}</dataValidations>`:''}<pageMargins left="0.4" right="0.4" top="0.6" bottom="0.6" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
};

const crcTable=()=>{const table=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0}return table};
const CRC=crcTable();
const crc32=bytes=>{let crc=0xffffffff;for(const byte of bytes)crc=CRC[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0};
const u16=value=>new Uint8Array([value&255,value>>>8&255]);
const u32=value=>new Uint8Array([value&255,value>>>8&255,value>>>16&255,value>>>24&255]);
const concat=parts=>{const size=parts.reduce((sum,part)=>sum+part.length,0),result=new Uint8Array(size);let offset=0;for(const part of parts){result.set(part,offset);offset+=part.length}return result};
const zip=files=>{const local=[],central=[];let offset=0;for(const file of files){const name=encoder.encode(file.name),data=typeof file.data==='string'?encoder.encode(file.data):file.data,crc=crc32(data),header=concat([u32(0x04034b50),u16(20),u16(0x0800),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),name]),record=concat([header,data]);local.push(record);central.push(concat([u32(0x02014b50),u16(20),u16(20),u16(0x0800),u16(0),u16(0),u16(0),u32(crc),u32(data.length),u32(data.length),u16(name.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),name]));offset+=record.length}const directory=concat(central),end=concat([u32(0x06054b50),u16(0),u16(0),u16(files.length),u16(files.length),u32(directory.length),u32(offset),u16(0)]);return concat([...local,directory,end])};

export function buildXlsx({sheets,creator='tie.event'}){
  if(!Array.isArray(sheets)||!sheets.length)throw new Error('Добавьте хотя бы один лист Excel.');
  const used=new Set(),prepared=sheets.map((sheet,index)=>({...sheet,columns:(sheet.columns||[]).map(column=>({...column})),name:safeSheetName(sheet.name,index,used)})),lists=[];
  for(const sheet of prepared)for(const column of sheet.columns){if(column.options?.length){column.listName=`_tie_list_${lists.length+1}`;lists.push({name:column.listName,options:column.options})}}
  let listSheet;
  if(lists.length){listSheet=safeSheetName('Варианты списков',prepared.length,used);const count=Math.max(...lists.map(list=>list.options.length));prepared.push({name:listSheet,title:'Варианты для выпадающих списков',hidden:true,filter:false,columns:lists.map((list,index)=>({key:`list${index}`,label:list.name,width:24})),rows:Array.from({length:count},(_,row)=>Object.fromEntries(lists.map((list,index)=>[`list${index}`,list.options[row]??null])))});}
  const overrides=prepared.map((_,index)=>`<Override PartName="/xl/worksheets/sheet${index+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
  const workbookSheets=prepared.map((sheet,index)=>`<sheet name="${xml(sheet.name)}" sheetId="${index+1}"${sheet.hidden?' state="hidden"':''} r:id="rId${index+1}"/>`).join('');
  const sheetRels=prepared.map((_,index)=>`<Relationship Id="rId${index+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index+1}.xml"/>`).join('');
  const definedNames=lists.length?`<definedNames>${lists.map((list,index)=>`<definedName name="${list.name}">'${xml(listSheet.replace(/'/g,"''"))}'!$${columnName(index)}$3:$${columnName(index)}$${list.options.length+2}</definedName>`).join('')}</definedNames>`:'';
  const created=new Date().toISOString(),styles=styleRegistry();
  const worksheets=prepared.map((sheet,index)=>({name:`xl/worksheets/sheet${index+1}.xml`,data:worksheet(sheet,styles)}));
  return zip([
    {name:'[Content_Types].xml',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${overrides}</Types>`},
    {name:'_rels/.rels',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`},
    {name:'docProps/core.xml',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>${xml(creator)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created></cp:coreProperties>`},
    {name:'xl/workbook.xml',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${workbookSheets}</sheets>${definedNames}<calcPr calcId="0" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`},
    {name:'xl/_rels/workbook.xml.rels',data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRels}<Relationship Id="rId${prepared.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`},
    {name:'xl/styles.xml',data:styles.xml()},
    ...worksheets
  ]);
}

export function downloadXlsx(workbook,fileName){
  const name=(String(fileName||'tie-export').replace(/[\\/:*?"<>|]+/g,'-').replace(/\s+/g,' ').trim()||'tie-export').replace(/\.xlsx$/i,'')+'.xlsx';
  const blob=new Blob([buildXlsx(workbook)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  return name;
}
