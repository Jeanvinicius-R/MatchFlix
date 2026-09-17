import { z } from "zod";

// Normalize (trim + lowercase) before validating the email format — checks
// run in chain order, so validating first would reject addresses that only
// have stray whitespace.
const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Informe um e-mail válido."));

export const signUpSchema = z
  .object({
    name: z.string().trim().min(2, "Informe seu nome completo."),
    email: emailField,
    password: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres."),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não coincidem.",
    path: ["confirmPassword"],
  });

export type SignUpInput = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Informe sua senha."),
});

export type SignInInput = z.infer<typeof signInSchema>;
