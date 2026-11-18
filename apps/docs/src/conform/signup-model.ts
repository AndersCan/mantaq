import { Actor, event, machine, state } from "@mantaq/core";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** The form is on screen with no problem showing. */
const fillingForm = state("fillingForm")();
/** The email was refused. */
const showingEmailProblem = state("showingEmailProblem")();
/** The password was refused. */
const showingPasswordProblem = state("showingPasswordProblem")();
/** The form is gone and the welcome is showing. */
const signedUp = state("signedUp")();

/** Type an email into the form. */
const typeEmail = event("typeEmail")<{ email: string }>();
/** Type a password into the form. */
const typePassword = event("typePassword")<{ password: string }>();
/** Press the Sign up button. */
const pressSignUp = event("pressSignUp")();

export const signupModel = machine("signupModel", {
  create: () =>
    Actor({
      inputs: [typeEmail, typePassword, pressSignUp],
      states: [fillingForm, showingEmailProblem, showingPasswordProblem, signedUp],
      initial: fillingForm,
      context: { email: "", password: "" },
      setup: (m) => {
        for (const from of [fillingForm, showingEmailProblem, showingPasswordProblem]) {
          m.on(from, {
            event: typeEmail,
            to: [fillingForm],
            handler: ({ payload }, { context }) => {
              context.set({ ...context.get(), email: payload.email });
              return { state: fillingForm };
            },
          });
          m.on(from, {
            event: typePassword,
            to: [fillingForm],
            handler: ({ payload }, { context }) => {
              context.set({ ...context.get(), password: payload.password });
              return { state: fillingForm };
            },
          });
        }
        m.on(fillingForm, {
          event: pressSignUp,
          to: [showingEmailProblem, showingPasswordProblem, signedUp],
          handler: (_event, { context }) => {
            const { email, password } = context.get();
            if (!EMAIL.test(email.trim())) return { state: showingEmailProblem };
            if (password.length < 8) return { state: showingPasswordProblem };
            return { state: signedUp };
          },
        });
      },
    }),
});
