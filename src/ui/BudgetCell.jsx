import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {applyBudgetFormat,budgetFontSizes,budgetFormatSegments,budgetSelectionStyle,budgetStyle,displayBudgetAmount,parseBudgetAmount,rebaseBudgetFormat,trimBudgetText} from '../budget-format.js';

const colors=[['Обычный','#434343'],['Сливовый','#665269'],['Красный','#b93646'],['Зелёный','#287354'],['Синий','#245c9c'],['Золотой','#8b621c']];
const highlights=[['Жёлтый','#fff0a6'],['Розовый','#f8dce7'],['Сиреневый','#e7def7'],['Зелёный','#d8efdf'],['Голубой','#dcecf9'],['Без выделения','none']];
const equal=(a,b)=>JSON.stringify(a||null)===JSON.stringify(b||null);
const textValue=(value,isText)=>isText?value||'':value==null?'':displayBudgetAmount(value);

function selectionOffsets(root){
  const selection=window.getSelection();if(!selection?.rangeCount)return null;
  const range=selection.getRangeAt(0);
  if(!root.contains(range.startContainer)||!root.contains(range.endContainer))return null;
  const start=range.cloneRange();start.selectNodeContents(root);start.setEnd(range.startContainer,range.startOffset);
  const end=range.cloneRange();end.selectNodeContents(root);end.setEnd(range.endContainer,range.endOffset);
  return{from:start.toString().length,to:end.toString().length,rect:range.getBoundingClientRect()};
}
function restoreSelection(root,from,to){
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),nodes=[];let node;
  while((node=walker.nextNode()))nodes.push(node);
  if(!nodes.length){root.appendChild(document.createTextNode(''));nodes.push(root.firstChild);}
  const point=offset=>{for(const node of nodes){if(offset<=node.textContent.length)return[node,offset];offset-=node.textContent.length;}const last=nodes.at(-1);return[last,last.textContent.length];};
  const range=document.createRange();range.setStart(...point(from));range.setEnd(...point(to));
  const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
}
function renderText(root,text,format){
  const nodes=budgetFormatSegments(text,format).map(segment=>{
    if(!Object.keys(segment.style).length)return document.createTextNode(segment.text);
    const span=document.createElement('span');span.textContent=segment.text;Object.assign(span.style,budgetStyle(segment.style));return span;
  });
  root.replaceChildren(...nodes);
}

export function FormatMenu({position,isText,range,format,text,onApply,onDone,menuRef}){
  const selected=budgetSelectionStyle(format,text,range.from,range.to);
  return createPortal(<div ref={menuRef} className="budget-format-menu" style={{left:position.left,top:position.top}} role="dialog" aria-label="Форматирование текста">
    <div className="budget-format-heading"><span>{isText&&range.from!==range.to?'Выделенный текст':'Вся ячейка'}</span><button type="button" onClick={onDone} aria-label="Готово — сохранить форматирование">Готово</button></div>
    <div className="budget-format-controls" role="toolbar" aria-label="Формат текста">
      <label><span className="sr-only">Размер шрифта</span><select aria-label="Размер шрифта" value={selected.fontSize||format?.style?.fontSize||16} onChange={event=>onApply({fontSize:Number(event.target.value)})}>{budgetFontSizes.map(size=><option key={size} value={size}>{size}</option>)}</select></label>
      <button type="button" className="budget-format-bold" aria-label="Жирный" aria-pressed={!!selected.bold} title="Жирный · Ctrl/⌘ B" onMouseDown={event=>event.preventDefault()} onClick={()=>onApply({bold:!selected.bold})}>B</button>
      <button type="button" className="budget-format-italic" aria-label="Курсив" aria-pressed={!!selected.italic} title="Курсив · Ctrl/⌘ I" onMouseDown={event=>event.preventDefault()} onClick={()=>onApply({italic:!selected.italic})}>I</button>
      <button type="button" className="budget-format-reset" onMouseDown={event=>event.preventDefault()} onClick={()=>onApply(null)}>Убрать форматирование</button>
    </div>
    <div className="budget-format-palette"><span>Цвет текста</span><div>{colors.map(([name,color])=><button type="button" key={color} className="budget-format-swatch" style={{'--swatch':color}} aria-label={`Цвет текста: ${name}`} aria-pressed={selected.color===color} onMouseDown={event=>event.preventDefault()} onClick={()=>onApply({color})}/>)}<label className="budget-format-custom" title="Другой цвет текста"><span>+</span><input type="color" aria-label="Другой цвет текста" value={selected.color||'#434343'} onChange={event=>onApply({color:event.target.value})}/></label></div></div>
    <div className="budget-format-palette"><span>Выделение цветом</span><div>{highlights.map(([name,color])=><button type="button" key={color} className={`budget-format-swatch${color==='none'?' is-none':''}`} style={{'--swatch':color==='none'?'#ffffff':color}} aria-label={`Выделение: ${name}`} aria-pressed={selected.highlight===color} onMouseDown={event=>event.preventDefault()} onClick={()=>onApply({highlight:color})}/>)}<label className="budget-format-custom" title="Другой цвет выделения"><span>+</span><input type="color" aria-label="Другой цвет выделения" value={selected.highlight&&selected.highlight!=='none'?selected.highlight:'#fff0a6'} onChange={event=>onApply({highlight:event.target.value})}/></label></div></div>
  </div>,document.body);
}

export function BudgetCell({row,field,value,format,label,onSave,name=false,note=false,group=false,canEdit=true,computed=false,textMode=false,limit,required=name,formatable=true,displayValue,parseValue}){
  const isText=name||note||textMode,maxLength=limit??(name?200:note?500:40);
  const display=v=>displayValue?displayValue(v):textValue(v,isText);
  const editor=useRef(null),menu=useRef(null),current=useRef({text:display(value),format:format||null});
  const selection=useRef({from:0,to:0}),editing=useRef(false),busy=useRef(false),history=useRef({past:[],future:[]}),initial=useRef({value,format}),menuMode=useRef('selection');
  const [active,setActive]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[popup,setPopup]=useState(null),[revision,setRevision]=useState(0);
  const redraw=()=>setRevision(version=>version+1);
  const update=(next,remember=true)=>{
    if(remember){history.current.past.push({...current.current,selection:{...selection.current}});if(history.current.past.length>100)history.current.past.shift();history.current.future=[];}
    current.current=next;setError('');redraw();
  };
  useEffect(()=>{
    if(computed&&current.current.text!==display(value)){
      current.current={...current.current,text:display(value)};renderText(editor.current,current.current.text,current.current.format);redraw();
    }
    if(active||saving||error)return;
    current.current={text:display(value),format:format||null};renderText(editor.current,current.current.text,current.current.format);redraw();
  },[value,format,active,saving,isText,error,computed]);
  const capture=()=>{
    const found=selectionOffsets(editor.current);if(found)selection.current={from:found.from,to:found.to};return found;
  };
  const openMenu=(rect=null,mode='selection')=>{
    if(!canEdit||!formatable||busy.current)return;
    menuMode.current=mode;
    const box=rect?.width?rect:editor.current.getBoundingClientRect();
    const width=Math.min(360,window.innerWidth-16),height=248;
    setPopup({left:Math.max(8,Math.min(box.left,window.innerWidth-width-8)),top:Math.max(8,Math.min(box.bottom+8,window.innerHeight-height-8))});
  };
  const begin=()=>{
    if(!canEdit||busy.current||editing.current)return;editing.current=true;setActive(true);history.current={past:[],future:[]};initial.current={value,format};
  };
  const finish=async()=>{
    setPopup(null);if(!editing.current||busy.current)return;
    editing.current=false;setActive(false);
    let next;
    try{
      const trimmed=isText?trimBudgetText(current.current.text,current.current.format):null;
      if(required&&isText&&!trimmed.text)throw new Error('Укажите название');
      next={value:computed?value:parseValue?parseValue(current.current.text):isText?trimmed.text:parseBudgetAmount(current.current.text),format:isText?trimmed.format:current.current.format};
    }catch(reason){setError(reason.message);return;}
    if(next.value===initial.current.value&&equal(next.format,initial.current.format))return;
    busy.current=true;setSaving(true);
    try{
      await onSave(row,field,next.value,next.format,computed||next.value===initial.current.value);
      current.current={text:display(next.value),format:next.format};renderText(editor.current,current.current.text,current.current.format);redraw();
    }catch(reason){setError(reason.message||'Не удалось сохранить. Повторите ввод.');}
    finally{busy.current=false;setSaving(false);}
  };
  const apply=patch=>{
    const draft=current.current,{from,to}=selection.current;
    update({...draft,format:applyBudgetFormat(draft.format,draft.text,from,to,patch,isText)});
    renderText(editor.current,current.current.text,current.current.format);editor.current.focus();restoreSelection(editor.current,from,to);
  };
  const insertPlain=text=>{
    if(!canEdit||computed)return;
    const draft=current.current,{from,to}=capture()||selection.current;
    const pasted=text.replace(/[\r\n\t]+/g,' ').slice(0,Math.max(0,maxLength-draft.text.length+to-from));
    const next=draft.text.slice(0,from)+pasted+draft.text.slice(to);
    update({text:next,format:isText?rebaseBudgetFormat(draft.format,draft.text,next):draft.format});
    renderText(editor.current,next,current.current.format);selection.current={from:from+pasted.length,to:from+pasted.length};restoreSelection(editor.current,selection.current.from,selection.current.to);
  };
  useEffect(()=>{
    if(!active)return;
    const changed=()=>{
      if(!editing.current)return;
      const found=capture();if(!found)return;
      if(found.from!==found.to)openMenu(found.rect);else if(menuMode.current==='selection')setPopup(null);
    };
    document.addEventListener('selectionchange',changed);
    return()=>document.removeEventListener('selectionchange',changed);
  },[active]);
  useEffect(()=>{
    if(!popup)return;
    const outside=event=>{if(!editor.current?.contains(event.target)&&!menu.current?.contains(event.target)){finish();}};
    const scroll=()=>{
      const rect=editor.current.getBoundingClientRect();
      if(rect.bottom<0||rect.top>window.innerHeight){setPopup(null);return;}
      const width=Math.min(360,window.innerWidth-16),left=Math.max(8,Math.min(rect.left,window.innerWidth-width-8)),top=Math.max(8,Math.min(rect.bottom+8,window.innerHeight-256));
      setPopup(previous=>previous&&(previous.left!==left||previous.top!==top)?{left,top}:previous);
    };
    document.addEventListener('pointerdown',outside);window.addEventListener('resize',scroll);document.addEventListener('scroll',scroll,true);
    return()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',scroll);document.removeEventListener('scroll',scroll,true);};
  },[!!popup]);
  const undo=redo=>{
    const source=redo?history.current.future:history.current.past,target=redo?history.current.past:history.current.future,next=source.pop();if(!next)return;
    target.push({...current.current,selection:{...selection.current}});update({text:next.text,format:next.format},false);selection.current=next.selection;
    renderText(editor.current,next.text,next.format);restoreSelection(editor.current,next.selection.from,next.selection.to);
  };
  return <>
    <div ref={editor} role="textbox" aria-label={label} aria-readonly={!canEdit||computed} aria-multiline="false" aria-invalid={!!error} aria-busy={saving} tabIndex={0} contentEditable={canEdit&&!computed&&!saving} suppressContentEditableWarning inputMode={isText?undefined:'decimal'}
      className={`couple-budget-input budget-rich-cell${name?' is-name':''}${note?' is-note':''}${group?' is-group':''}${computed?' is-computed':''}${!canEdit?' is-readonly':''}`}
      style={budgetStyle(current.current.format?.style)} data-revision={revision}
      title={canEdit?'Выделите текст или нажмите правой кнопкой для форматирования':label}
      onFocus={begin}
      onBlur={event=>{if(menu.current?.contains(event.relatedTarget)||popup&&!event.relatedTarget)return;finish();}}
      onMouseUp={()=>{const found=capture();if(found?.from!==found?.to&&found)openMenu(found.rect);}}
      onKeyUp={event=>{const found=capture();if(event.shiftKey&&found&&found.from!==found.to)openMenu(found.rect);}}
      onContextMenu={event=>{if(!canEdit||!formatable)return;event.preventDefault();editor.current.focus();capture();openMenu(null,'context');}}
      onBeforeInput={event=>{if(event.nativeEvent.inputType?.startsWith('insert')&&event.nativeEvent.inputType!=='insertCompositionText'){const range=capture()||selection.current;if(current.current.text.length-range.to+range.from+(event.nativeEvent.data?.length||1)>maxLength)event.preventDefault();}}}
      onInput={()=>{
        const draft=current.current,next=(editor.current.textContent||'').slice(0,maxLength);
        update({text:next,format:isText?rebaseBudgetFormat(draft.format,draft.text,next):draft.format});capture();
        if(editor.current.textContent!==next){renderText(editor.current,next,current.current.format);restoreSelection(editor.current,next.length,next.length);}
      }}
      onPaste={event=>{event.preventDefault();insertPlain(event.clipboardData.getData('text/plain'));}}
      onDrop={event=>{event.preventDefault();insertPlain(event.dataTransfer.getData('text/plain'));}}
      onKeyDown={event=>{
        if(event.nativeEvent.isComposing)return;
        const key=event.key.toLowerCase();
        if((event.ctrlKey||event.metaKey)&&canEdit&&['b','i','z','y'].includes(key)){
          event.preventDefault();capture();
          if(key==='z'||key==='y'){undo(key==='y'||event.shiftKey);return;}
          if(!formatable)return;
          const property=key==='b'?'bold':'italic',selected=budgetSelectionStyle(current.current.format,current.current.text,selection.current.from,selection.current.to);apply({[property]:!selected[property]});return;
        }
        if(event.key==='Enter'){event.preventDefault();finish();editor.current.blur();}
        if(event.key==='Escape'){
          event.preventDefault();editing.current=false;setActive(false);setPopup(null);setError('');current.current={text:display(value),format:format||null};renderText(editor.current,current.current.text,current.current.format);redraw();editor.current.blur();
        }
      }}/>
    {error&&<small className="couple-budget-error" role="alert">{error}</small>}
    {popup&&<FormatMenu menuRef={menu} position={popup} isText={isText} range={selection.current} format={current.current.format} text={current.current.text} onApply={apply} onDone={()=>{finish();editor.current.blur();}}/>}
  </>;
}
