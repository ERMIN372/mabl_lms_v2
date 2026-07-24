import { Routes, Route } from 'react-router-dom'
import { ScrollToTop } from './components/ScrollToTop'
import { PublicLayout } from './components/layout/PublicLayout'
import { ContentLayout } from './components/layout/ContentLayout'
import { AppLayout } from './components/layout/AppLayout'

import HomePage from './pages/HomePage'
import LoginPage from './pages/LoginPage'
import CheckoutPage from './pages/CheckoutPage'
import CoursesPage from './pages/CoursesPage'
import CourseDetailPage from './pages/CourseDetailPage'
import ProgramsPage from './pages/ProgramsPage'
import ProgramDetailPage from './pages/ProgramDetailPage'
import NewsPage from './pages/NewsPage'
import NewsDetailPage from './pages/NewsDetailPage'
import CalendarPage from './pages/CalendarPage'
import ForumPage from './pages/ForumPage'
import ForumTopicPage from './pages/ForumTopicPage'
import NotFoundPage from './pages/NotFoundPage'

import DashboardPage from './pages/DashboardPage'
import MaterialsPage from './pages/MaterialsPage'
import MaterialDetailPage from './pages/MaterialDetailPage'
import SurveysPage from './pages/SurveysPage'
import SurveyDetailPage from './pages/SurveyDetailPage'
import NotificationsPage from './pages/NotificationsPage'

import { AdminLayout } from './components/layout/AdminLayout'
import AdminOverviewPage from './pages/admin/AdminOverviewPage'
import AdminCoursesPage from './pages/admin/AdminCoursesPage'
import AdminCourseEditPage from './pages/admin/AdminCourseEditPage'
import AdminScormPage from './pages/admin/AdminScormPage'
import AdminUsersPage from './pages/admin/AdminUsersPage'
import AdminUserEditPage from './pages/admin/AdminUserEditPage'
import AdminOrdersPage from './pages/admin/AdminOrdersPage'
import AdminOrderEditPage from './pages/admin/AdminOrderEditPage'
import AdminEventsPage from './pages/admin/AdminEventsPage'
import AdminEventEditPage from './pages/admin/AdminEventEditPage'
import AdminNewsPage from './pages/admin/AdminNewsPage'
import AdminNewsEditPage from './pages/admin/AdminNewsEditPage'
import AdminForumPage from './pages/admin/AdminForumPage'
import AdminForumTopicEditPage from './pages/admin/AdminForumTopicEditPage'
import AdminMaterialsPage from './pages/admin/AdminMaterialsPage'
import AdminMaterialEditPage from './pages/admin/AdminMaterialEditPage'
import AdminSurveysPage from './pages/admin/AdminSurveysPage'
import AdminSurveyEditPage from './pages/admin/AdminSurveyEditPage'
import AdminNotificationsPage from './pages/admin/AdminNotificationsPage'
import AdminDatabasePage from './pages/admin/AdminDatabasePage'
import OfferPage from './pages/OfferPage'
import PrivacyPage from './pages/PrivacyPage'
import TermsPage from './pages/TermsPage'
import RequisitesPage from './pages/RequisitesPage'
import ConsentPersonalDataPage from './pages/ConsentPersonalDataPage'
import ConsentMarketingPage from './pages/ConsentMarketingPage'
import DocumentsPage from './pages/DocumentsPage'

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        {/* Публичная зона (только маркетинговые страницы) */}
        <Route element={<PublicLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/checkout" element={<CheckoutPage />} />
        </Route>

        {/* Общие разделы: гостю — публичный каркас, слушателю — каркас кабинета */}
        <Route element={<ContentLayout />}>
          <Route path="/programs" element={<ProgramsPage />} />
          <Route path="/programs/:id" element={<ProgramDetailPage />} />
          <Route path="/courses" element={<CoursesPage />} />
          <Route path="/courses/:id" element={<CourseDetailPage />} />
          <Route path="/news" element={<NewsPage />} />
          <Route path="/news/:id" element={<NewsDetailPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/forum" element={<ForumPage />} />
          <Route path="/forum/:id" element={<ForumTopicPage />} />
          <Route path="/materials" element={<MaterialsPage />} />
          <Route path="/materials/:id" element={<MaterialDetailPage />} />
          <Route path="/surveys" element={<SurveysPage />} />
          <Route path="/surveys/:id" element={<SurveyDetailPage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/requisites" element={<RequisitesPage />} />
          <Route path="/offer" element={<OfferPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/consent-personal-data" element={<ConsentPersonalDataPage />} />
          <Route path="/consent-marketing" element={<ConsentMarketingPage />} />
        </Route>

        {/* Аутентификация (без общего каркаса) */}
        <Route path="/login" element={<LoginPage />} />

        {/* Личный кабинет слушателя (защищённая зона) */}
        <Route element={<AppLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
        </Route>

        {/* Админ-панель: собственный каркас, доступ только для роли admin */}
        <Route element={<AdminLayout />}>
          <Route path="/admin" element={<AdminOverviewPage />} />
          <Route path="/admin/courses" element={<AdminCoursesPage />} />
          <Route path="/admin/courses/new" element={<AdminCourseEditPage />} />
          <Route path="/admin/courses/:id" element={<AdminCourseEditPage />} />
          <Route path="/admin/scorm" element={<AdminScormPage />} />
          <Route path="/admin/users" element={<AdminUsersPage />} />
          <Route path="/admin/users/new" element={<AdminUserEditPage />} />
          <Route path="/admin/users/:id" element={<AdminUserEditPage />} />
          <Route path="/admin/orders" element={<AdminOrdersPage />} />
          <Route path="/admin/orders/new" element={<AdminOrderEditPage />} />
          <Route path="/admin/orders/:id" element={<AdminOrderEditPage />} />
          <Route path="/admin/events" element={<AdminEventsPage />} />
          <Route path="/admin/events/new" element={<AdminEventEditPage />} />
          <Route path="/admin/events/:id" element={<AdminEventEditPage />} />
          <Route path="/admin/news" element={<AdminNewsPage />} />
          <Route path="/admin/news/new" element={<AdminNewsEditPage />} />
          <Route path="/admin/news/:id" element={<AdminNewsEditPage />} />
          <Route path="/admin/forum" element={<AdminForumPage />} />
          <Route path="/admin/forum/new" element={<AdminForumTopicEditPage />} />
          <Route path="/admin/forum/:id" element={<AdminForumTopicEditPage />} />
          <Route path="/admin/materials" element={<AdminMaterialsPage />} />
          <Route path="/admin/materials/new" element={<AdminMaterialEditPage />} />
          <Route path="/admin/materials/:id" element={<AdminMaterialEditPage />} />
          <Route path="/admin/surveys" element={<AdminSurveysPage />} />
          <Route path="/admin/surveys/new" element={<AdminSurveyEditPage />} />
          <Route path="/admin/surveys/:id" element={<AdminSurveyEditPage />} />
          <Route path="/admin/notifications" element={<AdminNotificationsPage />} />
          <Route path="/admin/database" element={<AdminDatabasePage />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  )
}
