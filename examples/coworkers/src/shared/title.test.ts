import { describe, expect, it } from "vitest";
import { titleOf } from "./title";

it("names a job in an app after what it leaves there", () => {
  expect(
    titleOf(
      "Sign in to the Larkspur Care support portal at https://larkspur.example.com as jo@example.com with $PORTAL_PASSWORD. Find Jordan Lee's AeroPure order, check whether it is still under warranty, and prepare a warranty claim for 'won't power on'. Ask me before you submit it.",
    ),
  ).toBe("Larkspur Care: warranty claim");
});

describe("titleOf", () => {
  it("names the site and what is wanted there", () => {
    expect(titleOf("Read the top five stories on Hacker News and tell me, in one line each, what people are arguing about in the comments.")).toBe("Hacker News: top stories");
    expect(titleOf("Open https://news.ycombinator.com and\n give me the top three stories with one line each.")).toBe("Hacker News: top stories");
    expect(titleOf("Fill in the contact form at https://httpbin.org/forms/post for a large cheese pizza and ask me before you submit it.")).toBe("httpbin: contact form");
  });

  it("names a document after what it holds", () => {
    expect(titleOf("Collect the first page of quotes from https://quotes.toscrape.com and make me a one-page PDF grouped by author.")).toBe("Quotes PDF");
  });

  it("leaves out the sign-in: the address, the account and the secret", () => {
    const goal = "Sign in to the Larkspur Care support portal at https://portal.example.com as jordan.lee@mail.example.com with $PORTAL_PASSWORD. Find Jordan Lee's AeroPure order, check whether it is still under warranty.";
    expect(titleOf(goal)).toBe("Larkspur Care: Jordan Lee's AeroPure order");
  });

  it("falls back to the words themselves", () => {
    expect(titleOf("hello")).toBe("Hello");
    expect(titleOf("What is the title of example.com?")).toBe("example: title");
  });
});
