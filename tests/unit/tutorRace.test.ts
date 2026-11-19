/** 交叉稽核 B1 的競態回歸測試：移植自 Codex 的 docs/audit-8892cb5-race.test.ts（複查 8892cb5）。 */
import {it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {MemoryRouter} from 'react-router';
import {render,fireEvent,act,cleanup} from '@testing-library/react';
import {questionsFor} from '../../src/content';
const state=vi.hoisted(()=>({teach:vi.fn(),record:vi.fn()}));
vi.mock('../../src/app/AppContext',()=>({useApp:()=>({settings:{tutorProvider:'mock'},level:'junior'})}));
vi.mock('../../src/ai',()=>{
 const provider={id:'mock',name:'mock',teach:state.teach};
 return {getProvider:()=>provider,mockProvider:provider,TUTOR_MODE_LABEL:{simple:'簡單解釋',detailed:'詳細教學',example:'舉例',compare:'比較',another:'再出一題'}};
});
vi.mock('../../src/data/repo',()=>({recordTutorAttempt:state.record,logTutor:vi.fn(async()=>{})}));
import {TutorPanel} from '../../src/components/TutorPanel';
it.each(['簡單解釋','再出一題'])('B1 old submission must not grade new reinforcement after %s',async(tab)=>{
 const [q,a,b]=questionsFor({competencyCode:'L11101'});let calls=0;let finish:(r:{correct:boolean})=>void=()=>{};
 state.teach.mockImplementation(async()=>({provider:'mock',label:'mock',sections:[],reinforcementQuestionId:++calls===1?a.id:b.id}));
 state.record.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const view=render(createElement(MemoryRouter,null,createElement(TutorPanel,{q,selected:[]})));
 try{
  fireEvent.click(view.getByText('重新教我這個觀念'));await view.findByText(a.stem);
  fireEvent.click(view.getByTestId('tutor-reinforcement').querySelector('label')!);fireEvent.click(view.getByTestId('tutor-submit'));
  fireEvent.click(view.getByRole('tab',{name:tab}));await view.findByText(b.stem);
  await act(async()=>{finish({correct:false});});
  expect(view.queryByText('補強題答錯。')).toBeNull();
 }finally{cleanup();}
});
