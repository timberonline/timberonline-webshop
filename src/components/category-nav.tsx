import Link from "next/link";
import { CATEGORIES, categoryPath } from "./categories";

/** Categoriechips boven de productlijst; `current` is de slug van de actieve categorie. */
export function CategoryNav({ current }: { current?: string }) {
  return (
    <nav aria-label="Categorieën" className="category-nav">
      <ul>
        <li>
          <Link href="/" className="chip" aria-current={current ? undefined : "page"}>
            Alles
          </Link>
        </li>
        {CATEGORIES.map((c) => (
          <li key={c.slug}>
            <Link href={categoryPath(c)} className="chip" aria-current={current === c.slug ? "page" : undefined}>
              {c.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
