import { useEffect, useRef, useState } from 'react'
import { products } from '../../content/products'
import { siteConfig } from '../../lib/seo'
import { useShop } from '../../lib/shop-context'
import { money } from '../../lib/api'
import { ProductPurchaseAction } from './ProductPurchaseAction'

export function MobilePurchaseBar({ menuOpen }: { menuOpen: boolean }) {
  const { catalog } = useShop()
  const bar = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const product = products[0]
  const listed = catalog.data?.products.find(item => item.code === product?.code)
  const enabled = siteConfig.showCartAccess && Boolean(listed) && !menuOpen
  useEffect(() => {
    if (!enabled) return
    let heroVisible = true, offerVisible = false, footerVisible = false
    const mobile = matchMedia('(max-width: 767px)')
    const update = () => {
      const active = document.activeElement
      const focusedOutside = active instanceof HTMLElement && active !== document.body && active !== document.documentElement && !bar.current?.contains(active)
      const viewportHeight = window.visualViewport?.height ?? innerHeight
      const height = bar.current?.offsetHeight ?? 0
      // Leave the screen to content at large text sizes or when the keyboard opens.
      setVisible(mobile.matches && !heroVisible && !offerVisible && !footerVisible && !focusedOutside && height < viewportHeight * .24 && viewportHeight > 440)
    }
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.target.matches('.hero')) heroVisible = entry.isIntersecting
        if (entry.target.matches('.offer-section')) offerVisible = entry.isIntersecting
        if (entry.target.matches('.site-footer')) footerVisible = entry.isIntersecting
      }
      update()
    })
    document.querySelectorAll('.hero, .offer-section, .site-footer').forEach(el => observer.observe(el))
    const resize = new ResizeObserver(update)
    if (bar.current) resize.observe(bar.current)
    mobile.addEventListener('change', update)
    window.visualViewport?.addEventListener('resize', update)
    document.addEventListener('focusin', update)
    document.addEventListener('focusout', update)
    return () => {
      observer.disconnect(); resize.disconnect(); mobile.removeEventListener('change', update)
      window.visualViewport?.removeEventListener('resize', update)
      document.removeEventListener('focusin', update); document.removeEventListener('focusout', update)
    }
  }, [enabled])
  if (!product || !enabled) return null
  return <div ref={bar} className="mobile-purchase-bar" inert={!visible} data-visible={visible} aria-label="Comprar o pacote"><div className="mobile-purchase-price"><span>{product.title}</span><strong>{listed?.price ? money(listed.price.unit_amount, listed.price.currency) : 'Preço indisponível'}</strong>{listed?.price && siteConfig.stage === 'test' && <small>Valor de teste</small>}</div><ProductPurchaseAction code={product.code} compact /></div>
}
