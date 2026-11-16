"use client";

import type { ComponentProps } from "react";

/** A filter form that applies as soon as a choice changes. The "הצגה" button stays, for keyboards and for typed fields. */
export function AutoSubmitForm(props: ComponentProps<"form">) {
  return (
    <form
      {...props}
      onChange={(e) => {
        if (e.target instanceof HTMLSelectElement) e.currentTarget.requestSubmit();
        props.onChange?.(e);
      }}
    />
  );
}
