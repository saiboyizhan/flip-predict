"use client";

import { motion } from "motion/react";
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
  "hackathon",
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
            <motion.button
              key={id}
              onClick={() => onCategoryChange(id)}
              whileTap={{ scale: 0.95 }}
              className={`relative shrink-0 px-3 py-1.5 sm:px-4 sm:py-2 text-xs sm:text-sm font-medium rounded-full transition-all duration-200 ${
                isSelected
                  ? "bg-blue-500/12 text-blue-400 border border-blue-500/25 shadow-sm shadow-blue-500/15"
                  : "bg-white/[0.04] border border-transparent text-muted-foreground hover:text-foreground hover:bg-white/[0.08]"
              }`}
            >
              {isSelected && (
                <motion.div
                  layoutId="category-highlight"
                  className="absolute inset-0 bg-blue-500/12 border border-blue-500/25 rounded-full"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                />
              )}
              <span className="relative z-10">
                {t(`category.${id}`)}
              </span>
            </motion.button>
          );
        })}
      </div>

      {/* Right Arrow */}
      <button
        onClick={() => scroll("right")}
        className="hidden md:flex shrink-0 w-8 h-8 items-center justify-center bg-muted border border-border rounded-lg text-muted-foreground hover:text-foreground hover:border-border transition-colors"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}
