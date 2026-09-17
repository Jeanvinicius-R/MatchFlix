import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { signInSchema } from "@/schemas/auth.schemas";
import { TooManyLoginAttemptsError, verifyCredentials } from "@/services/user.service";

class TooManyAttemptsSignInError extends CredentialsSignin {
  code = "too-many-attempts";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "E-mail", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      async authorize(rawCredentials) {
        const parsedCredentials = signInSchema.safeParse(rawCredentials);
        if (!parsedCredentials.success) {
          return null;
        }

        try {
          return await verifyCredentials(parsedCredentials.data);
        } catch (error) {
          if (error instanceof TooManyLoginAttemptsError) {
            throw new TooManyAttemptsSignInError();
          }
          throw error;
        }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) {
        token.id = user.id;
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id;
      session.user.role = token.role;
      return session;
    },
  },
});
