import type { Metadata } from "next";
import "./globals.css";
import "./auth.css";
import "./register.css";
import "./camera.css";

export const metadata: Metadata = {
  title: "Face Recognition Attendance System | Privacy-first Attendance",
  description: "Privacy-first attendance management research prototype",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en"><body>{children}</body></html>
  );
}
