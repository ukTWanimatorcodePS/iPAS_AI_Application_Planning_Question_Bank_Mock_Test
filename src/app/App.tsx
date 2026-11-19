import { lazy, Suspense } from 'react';
import { HashRouter, Route, Routes } from 'react-router';
import { AppProvider } from './AppContext';
import { Layout } from './Layout';
import { Dashboard } from '../pages/Dashboard';
import { CoursesIndex } from '../pages/Courses';
import { PracticePage } from '../pages/Practice';
import { QuizPage } from '../pages/Quiz';
import { ResultsPage } from '../pages/Results';
import { ReviewPage } from '../pages/Review';
import { PastExamsPage } from '../pages/PastExams';
import { MockPage } from '../pages/Mock';
import { SettingsPage } from '../pages/Settings';
import { MePage } from '../pages/Me';
import { SearchPage } from '../pages/Search';
import { NotFound } from '../pages/NotFound';
import { PlanPage } from '../pages/Plan';
import { SprintPage } from '../pages/Sprint';

const LessonPage = lazy(() => import('../pages/Lesson'));
const StatsPage = lazy(() => import('../pages/Stats'));

function Loading() {
  return (
    <div role="status" className="p-10 text-center text-muted">
      載入中…
    </div>
  );
}

/**
 * 使用 HashRouter：GitHub Pages 無伺服器端路由，HashRouter 可確保深連結與重新整理皆可運作。
 */
export function App() {
  return (
    <AppProvider>
      <HashRouter>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="courses" element={<CoursesIndex />} />
              <Route path="courses/:code" element={<LessonPage />} />
              <Route path="practice" element={<PracticePage />} />
              <Route path="quiz/:sessionId" element={<QuizPage />} />
              <Route path="results/:sessionId" element={<ResultsPage />} />
              <Route path="review" element={<ReviewPage />} />
              <Route path="past-exams" element={<PastExamsPage />} />
              <Route path="mock" element={<MockPage />} />
              <Route path="plan" element={<PlanPage />} />
              <Route path="sprint" element={<SprintPage />} />
              <Route path="stats" element={<StatsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="me" element={<MePage />} />
              <Route path="search" element={<SearchPage />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </Suspense>
      </HashRouter>
    </AppProvider>
  );
}
