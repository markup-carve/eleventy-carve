import carvePlugin from '@markup-carve/eleventy'

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(carvePlugin)

  return {
    dir: {
      input: 'input',
      output: '_site',
      includes: '_includes',
    },
    // Allow .crv/.carve files to be processed as templates.
    templateFormats: ['crv', 'carve'],
  }
}
