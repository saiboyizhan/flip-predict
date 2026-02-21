"use client";

import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

interface CategoryNavProps {
  selectedCategory: string;
  onCategoryChange: (category: string) => void;
}

const CATEGORY_IDS = [
  "all",
  "four-meme",
  "flap",
  "nfa",
];

export function CategoryNav({ selectedCategory, onCategoryChange }: CategoryNavProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: "left" | "right") => {
    if (scrollRef.current) {
      const scrollAmount = 200;
      scrollRef.current.scrollBy({
        left: direction === "left" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
    }
  };

  return (
    <div className="relative flex items-center gap-2">
      {/* Left Arrow */}
      <button
        onClick={() => scroll("left")}
        aria-label="Scroll categories left"
        className="hidden md:flex shrink-0 w-8 h-8 items-center justify-center bg-muted border border-border rounded-lg text-muted-foreground hover:text-foreground hover:border-border transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      {/* Scrollable Container */}
      <div
        ref={scrollRef}
        className="flex items-center gap-2 overflow-x-auto scrollbar-hide scroll-smooth"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {CATEGORY_IDS.map((id) => {
          const isSelected = selectedCategory === id;
          return (
            <button
              key={id}
              onClick={() => onCategoryChange(id)}
              className={`relative shrink-0 px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-medium rounded-full transition-all duration-200 ${
                isSelected
                  ? "bg-blue-500/12 text-blue-400 border border-blue-500/25 shadow-sm shadow-blue-500/15"
                  : "bg-white/[0.04] border border-transparent text-muted-foreground hover:text-foreground hover:bg-white/[0.08]"
              }`}
            >
              <span className="relative z-10">
                {t(`category.${id}`)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Right Arrow */}
      <button
        onClick={() => scroll("right")}
        aria-label="Scroll categories right"
        className="hidden md:flex shrink-0 w-8 h-8 items-center justify-center bg-muted border border-border rounded-lg text-muted-foreground hover:text-foreground hover:border-border transition-colors"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}
