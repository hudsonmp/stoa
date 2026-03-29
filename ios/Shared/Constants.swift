import Foundation

enum StoaConstants {
    static let appGroupID = "group.com.stoa.shared"
    static let keychainAccessGroup = "com.stoa.shared"

    // Default to local dev; overridden in Settings
    static var apiURL: String {
        let shared = UserDefaults(suiteName: appGroupID)
        return shared?.string(forKey: "apiURL") ?? "https://stoa-backend-production-9116.up.railway.app"
    }

    static var webappURL: String {
        let shared = UserDefaults(suiteName: appGroupID)
        return shared?.string(forKey: "webappURL") ?? "https://webapp-cvtbw8lu2-hudsonmp10.vercel.app"
    }

    // Supabase config (for Apple Sign-In → Supabase auth)
    static let supabaseURL = "https://nhttyppkcajodocrnqhi.supabase.co"
    static let supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5odHR5cHBrY2Fqb2RvY3JucWhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQzOTA5ODIsImV4cCI6MjA3OTk2Njk4Mn0.XbeUEF567uamBuqG8BlE_90p5zLQWlDd_L4WsmPfA7M"
}
