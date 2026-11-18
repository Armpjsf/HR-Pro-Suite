// Test-only Supabase query adapter backed by isolated PostgreSQL. No HTTP.
import { PGlite } from '@electric-sql/pglite';
export const database = new PGlite();
export const files = new Map();
const identifier = (s) => { if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw Error('Invalid test identifier'); return `"${s}"`; };
const json = (v) => JSON.parse(JSON.stringify(v));

class Query {
  constructor(table) { this.table=identifier(table); this.filters=[]; this.parameters=[]; this.action='select'; this.rows=[]; this.offset=0; }
  value(v) { this.parameters.push(v); return '$'+this.parameters.length; }
  select(columns='*', options={}) { this.columns=columns; this.options=options; return this; }
  eq(k,v) { this.filters.push(`${identifier(k)}=${this.value(v)}`); return this; }
  neq(k,v) { this.filters.push(`${identifier(k)}<>${this.value(v)}`); return this; }
  gt(k,v) { this.filters.push(`${identifier(k)}>${this.value(v)}`); return this; }
  gte(k,v) { this.filters.push(`${identifier(k)}>=${this.value(v)}`); return this; }
  lt(k,v) { this.filters.push(`${identifier(k)}<${this.value(v)}`); return this; }
  lte(k,v) { this.filters.push(`${identifier(k)}<=${this.value(v)}`); return this; }
  in(k,values) { this.filters.push(values.length ? `${identifier(k)} in (${values.map(v=>this.value(v)).join(',')})` : 'false'); return this; }
  is(k,v) { this.filters.push(`${identifier(k)} is ${v===null?'null':v?'true':'false'}`); return this; }
  not(k,op,v) { if(op!=='is'||v!==null)throw Error('Unsupported test filter');this.filters.push(`${identifier(k)} is not null`);return this; }
  like(k,v) { this.filters.push(`${identifier(k)} like ${this.value(v)}`);return this; }
  or(expression) {
    this.filters.push('('+expression.split(',').map((part)=>{ const [key,op,...rest]=part.split('.'); const value=rest.join('.'); if(op==='is'&&value==='null')return `${identifier(key)} is null`; if(op!=='eq')throw Error('Unsupported test or');return `${identifier(key)}=${this.value(value)}`; }).join(' or ')+')');
    return this;
  }
  order(key,{ascending=true}={}) { this.orderBy=`${identifier(key)} ${ascending?'asc':'desc'}`;return this; }
  limit(n) { this.max=Number(n);return this; }
  range(a,b) { this.offset=a;this.max=b-a+1;return this; }
  maybeSingle() { this.singleMode='maybe';return this; }
  single() { this.singleMode='required';return this; }
  insert(rows) { this.action='insert';this.rows=Array.isArray(rows)?rows:[rows];return this; }
  update(row) { this.action='update';this.rows=[row];return this; }
  delete() { this.action='delete';return this; }
  upsert(rows,options={}) { this.insert(rows);this.conflict=options.onConflict||'id';this.ignoreDuplicates=Boolean(options.ignoreDuplicates);return this; }
  then(resolve,reject) { return this.execute().then(resolve,reject); }
  async execute() {
    try {
      const where=this.filters.length?' where '+this.filters.join(' and '):'';
      let sql;
      if(this.action==='select') sql=`select * from ${this.table}${where}${this.orderBy?' order by '+this.orderBy:''}${this.max!==undefined?' limit '+this.max:''}${this.offset?' offset '+this.offset:''}`;
      if(this.action==='delete') sql=`delete from ${this.table}${where} returning *`;
      if(this.action==='update') sql=`update ${this.table} set ${Object.entries(this.rows[0]).map(([k,v])=>`${identifier(k)}=${this.value(v)}`).join(',')}${where} returning *`;
      if(this.action==='insert') {
        const keys=[...new Set(this.rows.flatMap(Object.keys))];
        sql=`insert into ${this.table} (${keys.map(identifier).join(',')}) values ${this.rows.map(row=>'('+keys.map(k=>k in row?this.value(typeof row[k]==='object'&&row[k]!==null&&!Array.isArray(row[k])?JSON.stringify(row[k]):row[k]):'default').join(',')+')').join(',')}`;
        if(this.conflict) {
          const target=this.conflict.split(',').map(identifier).join(',');
          sql+=this.ignoreDuplicates
            ?` on conflict (${target}) do nothing`
            :` on conflict (${target}) do update set ${keys.filter(k=>!this.conflict.split(',').includes(k)).map(k=>`${identifier(k)}=excluded.${identifier(k)}`).join(',')}`;
        }
        sql+=' returning *';
      }
      const result=await database.query(sql,this.parameters);
      const rows=json(result.rows);
      if(this.singleMode && (rows.length>1 || (this.singleMode==='required'&&!rows.length))) return { data:null,error:{code:'PGRST116',message:'Expected one row'} };
      return { data:this.options?.head?null:this.singleMode?rows[0]||null:rows,error:null,count:rows.length };
    } catch(e) { return { data:null,error:{ code:e.code,message:e.message } }; }
  }
}

export const supabase = {
  from: (table) => new Query(table),
  rpc(name,args={}) {
    let singular=false;
    const execute=async()=>{try {
      const entries=Object.entries(args||{}).filter(([,v])=>v!==undefined);
      const values=entries.map(([,v])=>v&&typeof v==='object'&&!Array.isArray(v)?JSON.stringify(v):v);
      const parameters=entries.map(([key],index)=>`${identifier(key)} => $${index+1}`).join(',');
      const result=await database.query(`select * from ${identifier(name)}(${parameters})`,values);
      if(singular&&result.rows.length!==1)return {data:null,error:{code:'PGRST116',message:'Expected one RPC row'}};
      const isScalar=result.rows.length===1&&result.rows[0]&&Object.keys(result.rows[0]).length===1&&name in result.rows[0];
      return { data:isScalar?json(result.rows[0][name]):singular?json(result.rows[0]):json(result.rows),error:null };
    } catch(e) { return { data:null,error:{code:e.code,message:e.message} }; }};
    const query={single(){singular=true;return query;},then(resolve,reject){return execute().then(resolve,reject);}};
    return query;
  },
  storage: { from() { return {
    download: async (key)=>files.has(key)?{data:new Blob([files.get(key)]),error:null}:{data:null,error:true},
  }; } },
};
export const DOCUMENTS_BUCKET='isolated-test';
