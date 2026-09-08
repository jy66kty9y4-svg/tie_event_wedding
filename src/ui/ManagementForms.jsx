import {DEFAULT_TASK_BLUEPRINTS,DEFAULT_TASK_PHASES} from '../task-blueprints.js';
import { useMemo, useState } from 'react';
import { FormField, Modal } from './Modal.jsx';
import { fieldTypes, permissionLabels } from '../shared.js';
const dataOf = value => value?.data || value || {};
const blankGrant = () => ({
  roleId: '',
  projectId: '',
  restrictions: {
    sections: [],
    rows: [],
    fields: []
  }
});
const words = value => String(value || '').split(',').map(x => x.trim()).filter(Boolean);
const GrantLine = ({
  grant,
  index,
  roles,
  projects,
  change,
  remove
}) => {
  const role = roles.find(item => item.id === grant.roleId),
    permissions = role?.permissions || [];
  return <fieldset className="column-editor"><legend>Назначение {index + 1}</legend><div className="form-columns"><FormField label="Роль"><select required value={grant.roleId} onChange={e => change('roleId', e.target.value)}><option value="">Выберите роль</option>{roles.map(r => <option key={r.id} value={r.id}>{r.name || dataOf(r).name}</option>)}</select></FormField><FormField label="Свадьба"><select value={grant.projectId || ''} onChange={e => change('projectId', e.target.value || null)}><option value="">Всё агентство</option>{projects.map(p => <option key={p.id} value={p.id}>{dataOf(p).name}</option>)}</select></FormField></div><p className="quiet-copy">{permissions.map(p => permissionLabels[p] || p).join(' · ') || 'Выберите роль'}</p><FormField label="Таблицы и разделы" hint="ID таблиц через запятую. Пусто — все разрешённые разделы."><input value={(grant.restrictions?.sections || []).join(', ')} onChange={e => change('restrictions', {
        ...grant.restrictions,
        sections: words(e.target.value)
      })} /></FormField><FormField label="Строки" hint="Необязательно: ID строк через запятую."><input value={(grant.restrictions?.rows || []).join(', ')} onChange={e => change('restrictions', {
        ...grant.restrictions,
        rows: words(e.target.value)
      })} /></FormField><FormField label="Поля" hint="Необязательно: ID полей через запятую."><input value={(grant.restrictions?.fields || []).join(', ')} onChange={e => change('restrictions', {
        ...grant.restrictions,
        fields: words(e.target.value)
      })} /></FormField><button type="button" className="text-button danger-text" onClick={remove}>Удалить назначение</button></fieldset>;
};
export function GrantEditor({
  user,
  state,
  onClose,
  onSave
}) {
  const users = state?.users || [],
    selected = user || users[0];
  const current = (state?.assignments || []).filter(g => g.user_id === (selected?.id || user?.id));
  const [userId, setUserId] = useState(selected?.id || '');
  const [disabled, setDisabled] = useState(!!selected?.disabled);
  const [grants, setGrants] = useState(current.map(g => ({
    roleId: g.role_id,
    projectId: g.project_id,
    restrictions: g.restrictions || {
      sections: [],
      rows: [],
      fields: []
    }
  })));
  const [error, setError] = useState('');
  const roles = state?.roles || [],
    projects = state?.projects || [];
  const submit = async e => {
    e.preventDefault();
    try {
      setError('');
      await onSave({
        userId,
        disabled,
        grants
      });
      onClose();
    } catch (caught) {
      setError(caught.message || 'Не удалось сохранить доступ');
    }
  };
  const switchUser = id => {
    setUserId(id);
    const next = users.find(item => item.id === id);
    setDisabled(!!next?.disabled);
    setGrants((state?.assignments || []).filter(g => g.user_id === id).map(g => ({
      roleId: g.role_id,
      projectId: g.project_id,
      restrictions: g.restrictions || {
        sections: [],
        rows: [],
        fields: []
      }
    })));
  };
  return <Modal wide title="Доступ пользователя" onClose={onClose}><form className="form-stack" onSubmit={submit}>{!user && <FormField label="Пользователь"><select required value={userId} onChange={e => switchUser(e.target.value)}><option value="">Выберите участника</option>{users.map(u => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}</select></FormField>}<label className="check-field"><input type="checkbox" checked={disabled} onChange={e => setDisabled(e.target.checked)} /> Отключить доступ</label>{grants.map((grant, index) => <GrantLine key={index} grant={grant} index={index} roles={roles} projects={projects} change={(key, value) => setGrants(items => items.map((item, i) => i === index ? {
        ...item,
        [key]: value
      } : item))} remove={() => setGrants(items => items.filter((_, i) => i !== index))} />)}<button type="button" className="text-button" onClick={() => setGrants(items => [...items, blankGrant()])}>+ Назначение</button>{error && <p className="form-error">{error}</p>}<div className="dialog-actions"><button type="button" className="button quiet" onClick={onClose}>Отмена</button><button className="button">Сохранить доступ</button></div></form></Modal>;
}
const blankColumn = () => ({
  id: `field_${crypto.randomUUID().slice(0, 8)}`,
  name: 'Новое поле',
  type: 'text'
});
const blankTable = (section = '') => ({
  key: `table_${crypto.randomUUID().slice(0, 8)}`,
  name: 'Новая таблица',
  section,
  offline: false,
  columns: [blankColumn()]
});
export function TemplateEditor({
  template,
  defaults,
  onClose,
  onSave
}) {
  const base = template ? dataOf(template) : defaults || {};
  const [blueprints,setBlueprints]=useState(base.taskBlueprints||DEFAULT_TASK_BLUEPRINTS);
  const [phases,setPhases]=useState(base.taskPhases||DEFAULT_TASK_PHASES);
  const [name, setName] = useState(base.name || 'Шаблон свадеб');
  const [sections, setSections] = useState(base.sections || []);
  const [tables, setTables] = useState(base.tables || []);
  const [offline, setOffline] = useState(base.offline || []);
  const [categories, setCategories] = useState((base.categories || []).join('\n'));
  const [error, setError] = useState('');
  const sectionKeys = useMemo(() => sections.map(s => s.key), [sections]);
  const save = async e => {
    e.preventDefault();
    try {
      setError('');
      await onSave({
        name,taskBlueprints:blueprints,taskPhases:phases,
        sections: sections.map((s, i) => ({
          ...s,
          order: i
        })),
        tables,
        categories: categories.split('\n').map(x => x.trim()).filter(Boolean),
        offline
      });
      onClose();
    } catch (caught) {
      setError(caught.message || 'Проверьте структуру шаблона');
    }
  };
  const editTable = (i, patch) => setTables(items => items.map((item, n) => n === i ? {
    ...item,
    ...patch
  } : item));
  const move = (setter, index, step) => setter(items => { const target=index+step; if(target<0||target>=items.length)return items; const next=[...items]; [next[index],next[target]]=[next[target],next[index]]; return next; });
  const nativeOffline=[['payouts','Предстоящие выплаты'],['budget','Смета'],['vendors','Подрядчики'],['files','Файлы']];
  return <Modal wide title={template ? 'Шаблон свадеб' : 'Новый шаблон'} onClose={onClose}><form className="form-stack" onSubmit={save}><FormField label="Название"><input required value={name} onChange={e => setName(e.target.value)} /></FormField><fieldset className="column-editor"><legend>Этапы подготовки</legend>{phases.map((phase,i)=><div key={phase.key}><input aria-label="Название этапа" value={phase.name} onChange={e=>setPhases(items=>items.map((x,n)=>n===i?{...x,name:e.target.value}:x))}/><button type="button" onClick={()=>setPhases(items=>items.filter((_,n)=>n!==i))}>Удалить этап</button></div>)}<button type="button" onClick={()=>setPhases(items=>[...items,{key:crypto.randomUUID(),name:'Новый этап'}])}>Добавить этап</button></fieldset><fieldset className="column-editor"><legend>Задачи подготовки</legend>{blueprints.map((task,i)=><div className="template-table" key={task.key}><FormField label="Задача"><input required value={task.title} onChange={e=>setBlueprints(items=>items.map((x,n)=>n===i?{...x,title:e.target.value}:x))}/></FormField><div className="form-columns"><FormField label="Этап"><select value={task.phaseKey} onChange={e=>setBlueprints(items=>items.map((x,n)=>n===i?{...x,phaseKey:e.target.value}:x))}>{phases.map(p=><option key={p.key} value={p.key}>{p.name}</option>)}</select></FormField><FormField label="Дней относительно свадьбы"><input type="number" min="-1095" max="1095" value={task.offsetDays} onChange={e=>setBlueprints(items=>items.map((x,n)=>n===i?{...x,offsetDays:Number(e.target.value)}:x))}/></FormField><FormField label="Ответственный"><select value={task.assigneeRole||''} onChange={e=>setBlueprints(items=>items.map((x,n)=>n===i?{...x,assigneeRole:e.target.value||null}:x))}>{[['','Не назначен'],['leadOrganizer','Ведущий организатор'],['couple','Пара, если участник один'],['organizer','Организатор, если участник один'],['coordinator','Координатор, если участник один']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></FormField></div><FormField label="Зависит от"><select multiple value={task.dependencyKeys||[]} onChange={e=>setBlueprints(items=>items.map((x,n)=>n===i?{...x,dependencyKeys:[...e.target.selectedOptions].map(o=>o.value)}:x))}>{blueprints.filter(x=>x.key!==task.key).map(x=><option key={x.key} value={x.key}>{x.title}</option>)}</select></FormField><button type="button" onClick={()=>setBlueprints(items=>items.filter((_,n)=>n!==i).map(x=>({...x,dependencyKeys:(x.dependencyKeys||[]).filter(k=>k!==task.key)})))}>Удалить задачу</button></div>)}<button type="button" onClick={()=>setBlueprints(items=>[...items,{key:crypto.randomUUID(),title:'Новая задача',phaseKey:phases[0]?.key||'general',offsetDays:0,order:items.length,dependencyKeys:[]}])}>Добавить задачу</button></fieldset><fieldset className="column-editor"><legend>Разделы</legend>{sections.map((section, i) => <div key={section.key}><input value={section.name} onChange={e => setSections(items => items.map((s, n) => n === i ? {
            ...s,
            name: e.target.value
          } : s))} /><small>{section.key}</small><button type="button" className="text-button" onClick={()=>move(setSections,i,-1)}>↑</button><button type="button" className="text-button" onClick={()=>move(setSections,i,1)}>↓</button><button type="button" className="icon-button" onClick={() => setSections(items => items.filter((_, n) => n !== i))}>×</button></div>)}<button type="button" className="text-button" onClick={() => setSections(items => [...items, {
          key: `section_${items.length + 1}`,
          name: 'Новый раздел'
        }])}>+ Раздел</button></fieldset><fieldset className="column-editor"><legend>Таблицы</legend>{tables.map((table, i) => <div key={table.key} className="template-table"><div className="form-columns"><input value={table.name} onChange={e => editTable(i, {
              name: e.target.value
            })} /><input value={table.key} onChange={e => editTable(i, {
              key: e.target.value
            })} /></div><small>Ключ: {table.key}</small><button type="button" className="text-button" onClick={()=>move(setTables,i,-1)}>↑</button><button type="button" className="text-button" onClick={()=>move(setTables,i,1)}>↓</button><select value={table.section} onChange={e => editTable(i, {
            section: e.target.value
          })}>{sectionKeys.map(key => <option key={key} value={key}>{key}</option>)}</select><label className="check-field"><input type="checkbox" checked={!!table.offline} onChange={e => editTable(i, {
              offline: e.target.checked
            })} /> Офлайн</label>{table.columns.map((column, columnIndex) => <div key={column.id} className="form-columns"><input value={column.name} onChange={e => editTable(i, {
              columns: table.columns.map((c, n) => n === columnIndex ? {
                ...c,
                name: e.target.value
              } : c)
            })} /><select value={column.type} onChange={e => editTable(i, {
              columns: table.columns.map((c, n) => n === columnIndex ? {
                ...c,
                type: e.target.value,
                ...(e.target.value === 'select' && !c.options ? {
                  options: []
                } : {})
              } : c)
            })}>{Object.entries(fieldTypes).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>{column.type==='select'&&<input value={(column.options||[]).join(', ')} onChange={e=>editTable(i,{columns:table.columns.map((c,n)=>n===columnIndex?{...c,options:words(e.target.value)}:c)})} placeholder="Варианты через запятую"/>}{column.type==='formula'&&<input value={column.formula||''} onChange={e=>editTable(i,{columns:table.columns.map((c,n)=>n===columnIndex?{...c,formula:e.target.value}:c)})} placeholder="{field_id} + 1"/>}<button type="button" className="text-button" onClick={()=>editTable(i,{columns:table.columns.filter((_,n)=>n!==columnIndex)})}>×</button><button type="button" className="text-button" onClick={()=>editTable(i,{columns:(()=>{const next=[...table.columns],target=columnIndex-1;if(target<0)return next;[next[columnIndex],next[target]]=[next[target],next[columnIndex]];return next;})()})}>↑</button></div>)}<button type="button" className="text-button" onClick={() => editTable(i, {
            columns: [...table.columns, blankColumn()]
          })}>+ Поле</button><button type="button" className="text-button danger-text" onClick={() => setTables(items => items.filter((_, n) => n !== i))}>Удалить таблицу</button></div>)}<button type="button" className="text-button" onClick={() => setTables(items => [...items, blankTable(sectionKeys[0] || '')])}>+ Таблица</button></fieldset><FormField label="Категории, по одной в строке"><textarea value={categories} onChange={e => setCategories(e.target.value)} /></FormField><fieldset className="permission-grid"><legend>Доступно офлайн</legend>{tables.map(table=><label key={table.key}><input type="checkbox" checked={offline.includes(table.key)} onChange={e=>setOffline(items=>e.target.checked?[...new Set([...items,table.key])]:items.filter(x=>x!==table.key))}/>{table.name}</label>)}{nativeOffline.map(([key,label])=><label key={key}><input type="checkbox" checked={offline.includes(key)} onChange={e=>setOffline(items=>e.target.checked?[...new Set([...items,key])]:items.filter(x=>x!==key))}/>{label}</label>)}</fieldset>{error && <p className="form-error">{error}</p>}<div className="dialog-actions"><button type="button" className="button quiet" onClick={onClose}>Отмена</button><button className="button">Сохранить шаблон</button></div></form></Modal>;
}
export function CategoryEditor({
  category,
  onClose,
  onSave
}) {
  const d = dataOf(category);
  const [name, setName] = useState(d.name || '');
  const [archived, setArchived] = useState(!!d.archived);
  const [error, setError] = useState('');
  return <Modal title={category ? 'Категория' : 'Новая категория'} onClose={onClose}><form className="form-stack" onSubmit={async e => {
      e.preventDefault();
      try {
        await onSave({
          name,
          archived
        });
        onClose();
      } catch (caught) {
        setError(caught.message || 'Не удалось сохранить категорию');
      }
    }}><FormField label="Название"><input autoFocus required value={name} onChange={e => setName(e.target.value)} /></FormField><label className="check-field"><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} /> Архивировать категорию</label>{error && <p className="form-error">{error}</p>}<div className="dialog-actions"><button type="button" className="button quiet" onClick={onClose}>Отмена</button><button className="button">Сохранить</button></div></form></Modal>;
}
