import { render, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";

import { MarkdownText } from "@/components/MarkdownText";

it("retains a rendered TeX formula when an assistant response completes in streaming layout", async () => {
  const source = String.raw`Before

\[
\tan\left(\frac{\mathrm{HFOV}}{2}\right)
=
\frac{W}{2f_x}

\]

After`;
  const { container, rerender } = render(
    <MarkdownText streaming preserveStreamingLayout>{source}</MarkdownText>,
  );
  await waitFor(() => expect(container.querySelector(".katex-display")).toBeInTheDocument(), {
    timeout: 10_000,
  });
  const formula = container.querySelector(".katex-display");
  const tex = container.querySelector("annotation")?.textContent;

  rerender(<MarkdownText preserveStreamingLayout>{source}</MarkdownText>);
  await waitFor(() => expect(container.querySelector(".katex-display")).toBe(formula));
  expect(container.querySelector("annotation")?.textContent).toBe(tex);
  expect(container.querySelector(".katex-error")).toBeNull();
  expect(container.querySelector("h1, h2")).toBeNull();
  expect(container).toHaveTextContent("Before");
  expect(container).toHaveTextContent("After");
});
